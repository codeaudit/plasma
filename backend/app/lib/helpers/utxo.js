'use strict';

import ethUtil from 'ethereumjs-util';
import levelDB from 'lib/db';
const BN = ethUtil.BN;
import config from "../../config";
const { prefixes: { utxoPrefix }, plasmaOperatorAddress } = config;

import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { PlasmaTransaction } from 'lib/model/tx';
import { TransactionOutput } from 'lib/model/output';

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');

async function getUTXO(blockNumber, txNumber, outputNumber) {
  let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(blockNumber)), blockNumberLength)
  let txNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(txNumber)), txNumberLength)
  let txOutputNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(outputNumber)), txOutputNumberLength)
  let query = Buffer.concat([utxoPrefix, blockNumberBuffer, txNumberBuffer, txOutputNumberBuffer]);
  
  try {
    let data = await levelDB.get(query);
    return new TransactionOutput(data);
  }
  catch(err) {
    return null;
  }
}
    
async function getAllUxtos(options = {}) {
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
          if (!options.json) {
            uxtos.push(output);
            return;
          }
          
          let outputJson = output.getJson();
          outputJson.blockNumber = ethUtil.bufferToInt(data.key.slice(blockStart, txStart))
          outputJson.txNumber = ethUtil.bufferToInt(data.key.slice(txStart, outputStart))
          outputJson.outputNumber = ethUtil.bufferToInt(data.key.slice(outputStart))
          if (options.includeKeys) {
            outputJson.key = data.key;
          }
          if (outputJson && options.address && options.address.toLowerCase() != outputJson.address.toLowerCase()) {
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

module.exports = {
  getAllUxtos,
  getUTXO
};
