
import depositEventHandler from 'lib/handlers/DepositEventHandler';
import { createSignedTransaction } from 'lib/tx';
import levelDB from 'lib/db';
import web3     from 'lib/web3';
import Promise from 'bluebird';
import {
  txNumberLength,
  txOutputNumberLength,
  blockNumberLength
} from 'lib/dataStructureLengths';
import config from "../config";
const { prefixes: { utxoPrefix } } = config;
const ethUtil = require('ethereumjs-util'); 
import RLP from 'rlp';
import txPool from 'lib/txPool';
const BN = ethUtil.BN;
import contractHandler from 'lib/contracts/plasma';

let statistic = {}

async function createDeposits(options = {}) {
  let accounts = await web3.eth.getAccounts();
  console.log('Accounts: ', accounts);
  
  for (let addr of accounts) {
    await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
    console.log('unlockAccount', addr);
  }
  
  let deposits = options.deposits || 5;
  var nextAddressGen = getNextAddress(accounts);

  let created = 0;

  for (let i = 0; i < deposits; i++) {
    try {
      let address = nextAddressGen.next().value;
      let amount = new BN('100000000000000000');
      console.log('amount1', amount);
      let add = new BN('1000000000000000');
      console.log('add', add);
      add = add.mul(new BN(i + 1));
      console.log('add1', add);

      amount = amount.add(add).toString();
      console.log('amount', amount);
      
      contractHandler.contract.methods.deposit().estimateGas({from: address, value: amount})
        .then(gas => {
          console.log('gas', gas);
          return contractHandler.contract.methods.deposit().send({from: address, gas, value: amount});
        })
      
      created++;
    }
    catch (error){
      console.log('Create deposit error', error);
    }
  }
  return created;
}

async function startTest(options = {}) {
  statistic = {
    created: 0,
    notCreated: 0 
  }
  
  let accounts = await web3.eth.getAccounts();
  accounts = accounts.map(address => address.toLowerCase());
  console.log('accounts', accounts);
  
  for (let addr of accounts) {
    await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
    console.log('Unlock Account', addr);
  }
  
  let txCount = options.count || 0;
  let startTime = Date.now();

  await createNewTransactions(accounts, txCount);
  
  let endTime = Date.now();
  console.log('Time ms: ', endTime - startTime)
  console.log('statistic ', statistic);
}

async function createNewTransactions(addresses, txCount) {
  let accounts = {};
  addresses.forEach(address => accounts[address] = true);
    
  let count = 0;
  var nextAddressGen = getNextAddress(addresses);

  while (count <= txCount) {
    let accountUtxos = {};
    let utxos = await txPool.getAllUxtos();
    
    if (txPool.poolLength > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
      continue;
    }

    utxos = utxos.reduce((res, utxo) => {
      let addr = utxo.address.toLowerCase();
      if (accounts[addr]) {
        res.push(utxo);
      }
      return res;
    }, []);
    
    count += utxos.length;
    utxos.forEach((uxto, index) => {
      return createTx(uxto, uxto.address, nextAddressGen.next(uxto.address).value, count);
    })
  }
}

function* getNextAddress(addresses) {
  let currentAddress = 0;
  let address;
  
  while(true) {
    if (!addresses[++currentAddress]) {
      currentAddress = 0;
    }
    if (address && addresses[currentAddress] == address) {
      if (!addresses[++currentAddress]) {
        currentAddress = 0;
        if (addresses[currentAddress] == address) {
          currentAddress++;
        }
      }
    }
    address = yield addresses[currentAddress];
  }
}

async function createTx(data, account, to, iter) {
  if (!account || !to ) {
    return false;
  }
  
  let txDataForRlp = [ 
    ethUtil.toBuffer(new BN(data.blockNumber)),
    ethUtil.toBuffer(new BN(data.txNumber)),
    ethUtil.toBuffer(new BN(data.outputNumber)), 
    undefined, undefined, undefined, 
    to.toLowerCase(), new BN(data.amount),
    undefined,undefined, undefined
  ];
  
  
  let txRlpEncoded = ethUtil.sha3(RLP.encode(txDataForRlp)).toString('hex');
  const signature = await web3.eth.sign(ethUtil.addHexPrefix(txRlpEncoded), account);

  let signedTxData = {
    inputs: [{
      blockNumber: data.blockNumber,
      txNumber: data.txNumber,
      outputNumber: data.outputNumber
    }],
    outputs: [{
      address: to,
      amount: data.amount
    }],
    sign1: signature
  }
  let tx = await createSignedTransaction(signedTxData);
  
  if (tx) {
    txPool.addTransaction(tx);
    statistic.created++;
    return true;
  }

  statistic.notCreated++;
}

module.exports = { startTest, createDeposits };
