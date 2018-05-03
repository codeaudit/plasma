'use strict';

import ethUtil from 'ethereumjs-util';
import levelDB from 'lib/db';
const BN = ethUtil.BN;
import config from "../config";
const { prefixes: { utxoPrefix }, plasmaOperatorAddress } = config;

import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { PlasmaTransaction } from 'lib/model/tx';
// import { TransactionOutput } from 'lib/model/output';

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');

async function getUTXO(blockNumber, token_id) {
  let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(blockNumber)), blockNumberLength)
  let query = Buffer.concat([utxoPrefix, blockNumberBuffer, token_id]);

  try {
    let data = await levelDB.get(query);
    return new PlasmaTransaction(data);
  }
  catch(err) {
    return null;
  }
}

function createDepositTransaction(addressTo, amountBN, token_id) {
  let txData = {
    prev_hash: '',
    prev_block: new BN(0),
    token_id,
    new_owner: ethUtil.addHexPrefix(addressTo)
  };
  
  const tx = new PlasmaTransaction(txData);
  return tx;
}

async function createSignedTransaction(data) {
  let txData = {};
  txData.prev_block = data.prev_block;
  txData.token_id = data.token_id;
  txData.new_owner = data.new_owner;
  txData.signature = data.signature;
  
  // let utxo = await getUTXO(txData.prev_block, txData.token_id);
  // if (!utxo) {
  //   return false;
  // }
  
  let tx = new PlasmaTransaction(txData);
  return tx;
}

module.exports = {
  createDepositTransaction,
  createSignedTransaction,
  getUTXO
};
