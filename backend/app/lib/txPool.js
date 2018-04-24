'use strict';

import { logger } from 'lib/logger';
import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { checkTransactionInputs } from 'lib/tx';

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');

class TXPool {
  constructor (config = {}) {
    this.transactions = [];
    this.inputKeys = {};
  }

  get length() {
    return this.transactions.length;
  }

  addTransaction(tx) {
    this.transactions.push(tx);
  }

  removeTransactions(txCount) {
    this.transactions = this.transactions.slice(txCount);
  }

  getTransaction(txCount) {
    return this.transactions.slice(0, txCount);
  }

  async getTransactionCheckInputs(txCount) {
    let txs = this.getTransaction(txCount);
    let allTxInputKeys = {};
    txs = txs.filter((tx) => {
      let inputKeys = tx.getInputKeys();
      let isUnique = true;
      for (let key of inputKeys) {
        if (allTxInputKeys[key] && key != depositInputKey) {
          isUnique = false;
        } else {
          allTxInputKeys[key] = true;
        }
      }
      return isUnique;
    });
    
    let txsValidated = [];
    for (let tx of txs) {
      let isValid = await checkTransactionInputs(tx);
      if (isValid) {
        txsValidated.push(tx);
      }
    }

    return txsValidated;
  }
};

const txPool = new TXPool();

export default txPool;
