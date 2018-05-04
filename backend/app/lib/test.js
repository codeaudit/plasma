
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

var accounts = {
  1: {address:'0x11A618DE3ADe9B85Cd811BF45af03bAd481842Ed', pkey: ''},
  2: {address:'0xA5Fe0dEda5E1a0FCc34B02B5BE6857e30C9023fE', pkey: ''},
}


async function startTest(options = {}) {
  let txCount = options.txCount || 1000;
  let transactions = [];
  let deporits = [];
  let depositBlock = 1;
  // console.log('startTest',)
  let startTime = Date.now();
  // console.log('startTime', startTime)

  let currentAcc = accounts[1];
  for (let index = 0; index < 1000; index++) {
    let uxtos = await getAllUxtos();
    let uxto1 = uxtos.find(u => u.address.toLowerCase() == accounts[1].address.toLowerCase());
    let uxto2 = uxtos.find(u => u.address.toLowerCase() == accounts[2].address.toLowerCase());

    if (uxto1 && uxto1.amount) {
      await createTx(uxto1, accounts[1], accounts[2].address);
    } else if (uxto2 && uxto2.amount) {
      await createTx(uxto2, accounts[2], accounts[1].address);
    }
  }
  let endTime = Date.now();
  // console.log('endTime', endTime)
  console.log('Time ms: ', endTime - startTime)
}

async function createTx(data, account, to) {
  // let txData = [ data.blockNumber, data.txNumber, data.outputNumber, undefined, undefined, undefined, to, data.amount,undefined,undefined, undefined];
  
  let txDataForRlp = [ 
    ethUtil.toBuffer(new BN(data.blockNumber)),
    ethUtil.toBuffer(new BN(data.txNumber)),
    ethUtil.toBuffer(new BN(data.outputNumber)),
    undefined, undefined, undefined, to.toLowerCase(), new BN(data.amount),undefined,undefined, undefined];

  let txRlpEncoded = ethUtil.sha3(RLP.encode(txDataForRlp)).toString('hex');
  const signature = ethUtil.ecsign(Buffer.from(txRlpEncoded, 'hex'), Buffer.from(account.pkey, 'hex'));
  let signatureRaw = ethUtil.toRpcSig(signature.v, signature.r, signature.s);

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
    sign1: signatureRaw
  }
  let tx = await createSignedTransaction(signedTxData);
  await txPool.addTransaction(tx);
  console.log('add tx--------------------------', to, ' tx ', data.txNumber, ' out ', data.outputNumber);
}


async function getAllUxtos(address) {
  return await new Promise((resolve, reject) => {
    try { 
      const uxtos = [];    
      const start = Buffer.concat([utxoPrefix, 
        Buffer.alloc(blockNumberLength),
        Buffer.alloc(txNumberLength),
        Buffer.alloc(txOutputNumberLength)]
      );
      const end = Buffer.concat([utxoPrefix, 
        Buffer.from("ff".repeat(blockNumberLength + txNumberLength + txOutputNumberLength), 'hex')]
      );
      
      let blockStart = utxoPrefix.length;
      let txStart = blockStart + blockNumberLength;
      let outputStart = txStart + txNumberLength;
      
      levelDB.createReadStream({gte: start, lte: end})
        .on('data', function (data) {
          let output = new TransactionOutput(data.value);
          
          let outputJson = output.getJson();
          outputJson.blockNumber = ethUtil.bufferToInt(data.key.slice(blockStart, txStart))
          outputJson.txNumber = ethUtil.bufferToInt(data.key.slice(txStart, outputStart))
          outputJson.outputNumber = ethUtil.bufferToInt(data.key.slice(outputStart))

          if (outputJson && address && address.toLowerCase() != outputJson.address.toLowerCase()) {
            return;
          }
          uxtos.push(outputJson);
        })
        .on('error', function (error) {
            console.log('error', error);
        })
        .on('end', function () {
          resolve(uxtos)
        })
    }
    catch(error){
      console.log('error', error);
    }
  })
}

module.exports = { startTest };