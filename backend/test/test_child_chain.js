'use strict';

var assert = require('assert');
import chai           from 'chai';
var expect = chai.expect;

import SparseMerkle   from '../app/lib/SparseMerkle';
import web3           from '../app/lib/web3';
import ethUtil        from 'ethereumjs-util';
import { getAllUtxos } from '../app/lib/tx';
import { createSignedTransaction } from '../app/lib/tx';
import config from "../app/config";
import RLP from 'rlp';
import txPool from '../app/lib/txPool';

function* getNextAddress(addresses) {
  let currentAddress = 0;
  let addressToExclude;

  while(true) {
    if (!addresses[++currentAddress]) {
      currentAddress = 0;
    }
    if (addressToExclude && addresses[currentAddress] == addressToExclude) {
      if (!addresses[++currentAddress]) {
        currentAddress = 0;
        if (addresses[currentAddress] == addressToExclude) {
          currentAddress++;
        }
      }
    }
    addressToExclude = yield addresses[currentAddress];
  }
}

async function createTx(utxo, account, to) {
  let txData = {
    prev_hash: utxo.getHash().toString('hex'),
    prev_block: utxo.blockNumber,
    token_id: utxo.token_id.toString(),
    new_owner: to
  };

  let txDataForRlp = [ethUtil.addHexPrefix(txData.prev_hash), txData.prev_block, ethUtil.toBuffer(txData.token_id), txData.new_owner];
  let txRlpEncoded = ethUtil.sha3(RLP.encode(txDataForRlp)).toString('hex');

  let signature = await web3.eth.sign(ethUtil.addHexPrefix(txRlpEncoded), account);
  txData.signature = signature;
  let createdTx = await createSignedTransaction(txData);
  return createdTx;
}

describe('ChildChain', function () {
  let accounts = [];
  var nextAddressGen;
  
  before(async function() {
    accounts = await web3.eth.getAccounts();
    accounts = accounts.reduce((res, account) => {
      account = account.toLowerCase();
      if (account != config.plasmaOperatorAddress.toLowerCase()) {
        res.push(account);
      }
      return res;
    }, []);
    
    for (let addr of accounts) {
      await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
    }
    
    expect(accounts).to.have.lengthOf.above(1);
    nextAddressGen = getNextAddress(accounts);
    nextAddressGen.next();
  });

  it('should return test accounts list from ethernode keystore excluding operator address', async function () {
    expect(accounts).to.have.lengthOf.above(1);
  })

  it('should get correct address from created trasaction signature', async function () {
    let utxos = await getAllUtxos(null, {});
    let utxo = utxos.find( u => accounts.some(a => ethUtil.addHexPrefix(u.new_owner.toString('hex').toLowerCase()) == a.toLowerCase()));
    expect(utxo).to.exist;
    
    let account = ethUtil.addHexPrefix(utxo.new_owner.toString('hex')).toLowerCase();
    let createdTx = await createTx(utxo, account, nextAddressGen.next(account).value);
    let addressFromSignature = createdTx.getAddressFromSignature(true);

    expect(addressFromSignature).to.equal(account); 
  })
  
  
  
  describe('Check Block Creation', async function () {
    let utxosBeforeTest;
    
    before(async function() {
      utxosBeforeTest = await getAllUtxos(null, {});
      expect(utxosBeforeTest).to.have.lengthOf.above(1);
    });
    
    it('should create transactions from utxos and write block', async function () {
      for (let utxo of utxosBeforeTest) {
        let ownerAccount = ethUtil.addHexPrefix(utxo.new_owner.toString('hex')).toLowerCase();
        let createdTx = await createTx(utxo, ownerAccount, nextAddressGen.next(ownerAccount).value);
        if (createdTx) {
          await txPool.addTransaction(createdTx);
        }
      }

      expect(txPool.length).to.equal(utxosBeforeTest.length);
      
      let newBlock = await txPool.createNewBlock();
      expect(newBlock).to.exist;
      
      let newUtxos = await getAllUtxos(null, {});

      newUtxos.forEach(tx => {
        let proof = newBlock.merkle.getProof({ key: tx.token_id });
        let proofIsValid = newBlock.merkle.checkProof(proof, tx.getHash().toString('hex'), newBlock.merkleRootHash);

        expect(proofIsValid);
      })
    
    })
    
  })

});
