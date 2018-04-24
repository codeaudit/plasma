'use strict';

import ethUtil from 'ethereumjs-util';
import levelDB from 'lib/db';
const BN = ethUtil.BN;
import config from "../config";
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
    console.log('getUTXO err ', err);
    return null;
  }
}
    
function createDepositTransaction(addressTo, amountBN, depositBlockIndexBN) {
  let empty = ethUtil.toBuffer(new BN(0));
  let txData = {
    blockNumber1: empty,
    txNumber1: empty,
    outputNumber1: empty,
    blockNumber2: empty,
    txNumber2: empty,
    outputNumber2: empty,
    newowner1: ethUtil.addHexPrefix(addressTo),
    denom1: amountBN,
    newowner2: 0,
    denom2: empty
  };
  const tx = new PlasmaTransaction(txData);

  return tx;
}

async function createSignedTransaction(data) {
  let txData = {};
  let inputIndex = 0;
  let outputIndex = 0;
  let inputsTotalAmount = new BN(0);
  let outputsTotalAmount = new BN(0);
  
  txData.sig1 = data.sign1;
  txData.sig2 = data.sign2;

  for (let input of data.inputs) {
    let utxo = await getUTXO(input.blockNumber, input.txNumber, input.outputNumber);
    if (!utxo) {
      return false;
    }

    txData[`blockNumber${inputIndex + 1}`] = ethUtil.toBuffer(new BN(input.blockNumber));
    txData[`txNumber${inputIndex + 1}`] = ethUtil.toBuffer(new BN(input.txNumber));
    txData[`outputNumber${inputIndex + 1}`] = ethUtil.toBuffer(new BN(input.outputNumber));
    inputsTotalAmount = inputsTotalAmount.add(new BN(utxo.denom));
    inputIndex++;
  }
  
  for (let output of data.outputs) {
    let denom = new BN(output.amount);
    let newowner = ethUtil.addHexPrefix(output.address.toLowerCase());
    if (denom.lte(0)) {
      return false;
    }
    
    txData[`newowner${inputIndex + 1}`] = newowner;
    txData[`denom${inputIndex + 1}`] = denom;
    outputsTotalAmount = outputsTotalAmount.add(denom);
    outputIndex++;
  }

  if (!inputsTotalAmount.eq(outputsTotalAmount)) {
    return null;
  }

  let tx = new PlasmaTransaction(txData);
  return tx;
}

async function checkTransactionInputs(transaction) {
  try {
    let txInputKeys = transaction.getInputKeys();
    if (txInputKeys.join('') == depositInputKey + depositInputKey) {
      // allow deposit transaction only signed by operator
      let address1 = transaction.getAddressFromSignature(1, true).toLowerCase();
      let address2 = transaction.getAddressFromSignature(2, true).toLowerCase();
      return address1 == address2 && plasmaOperatorAddress.toLowerCase() == address1;
    }
    
    let inputsTotalAmount = new BN(0);
    let outputsTotalAmount = new BN(0);
    
    for (let inputIndex of [1, 2]) {
      let input = transaction.getTransactionInput(inputIndex);
      if (input) {
        let utxo = await getUTXO(input[0], input[1], input[2]);
        if (!utxo) {
          return false;
        }
        let address = transaction.getAddressFromSignature(inputIndex);
        address = ethUtil.addHexPrefix(address.toString('hex').toLowerCase());
        let newowner = ethUtil.addHexPrefix(utxo.newowner.toString('hex').toLowerCase());
        
        if (address != newowner) {
          return false;
        }
        inputsTotalAmount = inputsTotalAmount.add(new BN(utxo.denom));
      }
    }
    
    for (let outputIndex of [1, 2]) {
      let output = transaction.getTransactionOutput(outputIndex);

      if (output) {
        outputsTotalAmount = outputsTotalAmount.add(new BN(output[1]));
      }
    }

    if (!inputsTotalAmount.eq(outputsTotalAmount)) {
      return false;
    }
    
    return true;
  }
  catch (error) {
    return false;
  }
}

module.exports = {
  createDepositTransaction,
  createSignedTransaction,
  checkTransactionInputs
};
