'use strict';

import Block from 'lib/model/block';
import config from "../config";
import Web3 from 'web3';
import ethUtil from 'ethereumjs-util'; 
const BN = ethUtil.BN;

import levelDB from 'lib/db';
import { logger } from 'lib/logger';
import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { checkTransactionInputs } from 'lib/tx';
const { prefixes: { blockPrefix, transactionPrefix, utxoPrefix, lastBlockSubmittedToParentPrefix } } = config;

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');

class TXPool {
  constructor () {
    this.transactions = [];
    this.newBlockNumber;
    this.newBlockNumberBuffer;
    this.inputKeys = {};
    this.currentTransactionNumberInBlock = 0;
  }

  get length() {
    return this.transactions.length;
  }

  async addTransaction(tx) {
    if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
      await this.getLastBlockNumberFromDb();
    }

    let isValid = await checkTransactionInputs(tx);
    if (!isValid) {
      return false;
    }
    
    await this.updateTransactionUxtos(tx, ++this.currentTransactionNumberInBlock);
    this.transactions.push(tx);
    return true;
  }
  
  async updateTransactionUxtos(tx, transactionNumberInBlock) {
    let queryAll = [];

    let txIndexInBlockBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(this.currentTransactionNumberInBlock)), txNumberLength);
    for (let inputIndex of [1, 2]) {
      let input = tx.getTransactionInput(inputIndex);
      if (!!input) {
        let keyUTXO = Buffer.concat([utxoPrefix, 
          ethUtil.setLengthLeft(ethUtil.toBuffer(input[0]), blockNumberLength),
          ethUtil.setLengthLeft(ethUtil.toBuffer(input[1]), txNumberLength),
          ethUtil.setLengthLeft(ethUtil.toBuffer(input[2]), txOutputNumberLength)
        ]);
        queryAll.push({ type: 'del', key: keyUTXO });
      }
    }
    let currentOutputIndex = 1;
    for (let outputIndex of [1, 2]) {
      let outputRlp = tx.getTransactionOutputRlp(outputIndex);
      if (outputRlp) {
        let outputNumberInTxBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(currentOutputIndex)),txOutputNumberLength)
        let keyUTXO = Buffer.concat([utxoPrefix, this.newBlockNumberBuffer, txIndexInBlockBuffer, outputNumberInTxBuffer]);
        queryAll.push({ type: 'put', key: keyUTXO, value: outputRlp });
        currentOutputIndex++;
      }
    }

    await levelDB.batch(queryAll);
    return true;
  }
  
  async getLastBlockNumberFromDb() {
    let lastBlock;
    try{
      lastBlock = await levelDB.get('lastBlockNumber');
    }
    catch(error) {
      lastBlock = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(0)), blockNumberLength);
      await levelDB.put('lastBlockNumber', lastBlock);
    }
    let lastBlockNumber = Web3.utils.toBN(ethUtil.addHexPrefix(lastBlock.toString('hex')));
    let newBlockNumber = lastBlockNumber.add(new BN(config.contractblockStep));

    this.newBlockNumber = newBlockNumber;
    this.newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(newBlockNumber), blockNumberLength);
  }
  
  async createNewBlock() {
    try{
      if (!this.newBlockNumber) {
        await this.getLastBlockNumberFromDb();
      }
      
      let txCount;
      let transactions;
      
      if (this.transactions.length == 0) {
        return false;
      }
      if (this.transactions.length > 2**16){
        txCount = 2**16;
      } else {
        txCount = this.transactions.length;
      }

      transactions = this.transactions.slice(0, txCount);
      if (transactions.length == 0) {
        return false;
      }
      
      // const lastBlockNumber = Web3.utils.toBN(ethUtil.addHexPrefix(lastBlock.toString('hex')));
      // const newBlockNumber = lastBlockNumber.add(new BN(config.contractblockStep));
      const newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(this.newBlockNumber), blockNumberLength);
      const blockData = {
        blockNumber:  newBlockNumberBuffer,
        transactions: transactions
      }
      const block = new Block(blockData); 

      // await this.saveBlock(block);
      
      let queryAll = [
        { type: 'put', key: 'lastBlockNumber', value: block.blockNumber },
        { type: 'put', key: Buffer.concat([blockPrefix, block.blockNumber]), value: block.getRlp() }
      ];
      await levelDB.batch(queryAll);
      
      this.transactions = this.transactions.slice(txCount);
      this.currentTransactionNumberInBlock = 0;
      this.newBlockNumber = this.newBlockNumber.add(new BN(config.contractblockStep));
      this.newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(this.newBlockNumber), blockNumberLength);
      console.log('New block created: ', this.newBlockNumber.toString(), ' ', 'transactions: ', txCount);

      return true;
    }
    catch(err){
      logger.error('createNewBlock error ', err);
    }
  }     
    
  checkInputKeys(tx) {
    let inputKeys = tx.getInputKeys();
    let isUnique = true;
    for (let key of inputKeys) {
      if (this.inputKeys[key] && key != depositInputKey) {
        isUnique = false;
      } else {
        this.inputKeys[key] = true;
      }
    }
    return isUnique;
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
