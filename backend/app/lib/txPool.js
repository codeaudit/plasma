'use strict';

import Block from 'lib/model/block';
import config from "../config";
import Web3 from 'web3';
import ethUtil from 'ethereumjs-util'; 
const BN = ethUtil.BN;

import levelDB from 'lib/db';
import { logger } from 'lib/logger';
import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { getUTXO } from 'lib/tx';
const { prefixes: { blockPrefix, transactionPrefix, utxoPrefix, lastBlockSubmittedToParentPrefix } } = config;

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');/////
const depositPreviousBlockBn = new BN(0);

class TXPool {
  constructor () {
    this.transactions = [];
    this.newBlockNumber;
    this.newBlockNumberBuffer;
    this.inputKeys = {};
  }

  get length() {
    return this.transactions.length;
  }

  async addTransaction(tx) {
    if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
      await this.getLastBlockNumberFromDb();
    }

    let isValid = await checkTransaction(tx);

    if (!isValid) {
      return false;
    }
    
    // await this.updateUtxos(tx, ++this.currentTransactionNumberInBlock);
    this.transactions.push(tx);
    return true;
  }
  
  
  async checkTransaction(transaction) {
    try {
      let address = ethUtil.addHexPrefix(transaction.getAddressFromSignature('hex').toLowerCase());    
      
      if (new BN(transaction.prev_block).eq(depositPreviousBlockBn)) {
        let valid = address == config.plasmaOperatorAddress.toLowerCase();
        if (!valid) {
          return false;
        }
      } else {
        let newowner = ethUtil.addHexPrefix(transaction.new_owner.toString('hex').toLowerCase());
        if (address != newowner) {
          return false;
        }
        
        let utxo = await getUTXO(transaction.prev_block, token_id);
        if (!utxo) {
          return false;
        }
        let utxoOwnerAddress = ethUtil.addHexPrefix(utxo.new_owner.toString('hex').toLowerCase());

        if (utxoOwnerAddress != newowner) { //check utxo previous owner
          return false;
        }
        transaction.prev_hash = utxo.getHash();
      }
        
      return true;
    }
    catch (error) {
      console.log('checkTransactionInputs   error  ', error);
      return false;
    }
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
      
      const newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(this.newBlockNumber), blockNumberLength);
      const blockData = {
        blockNumber:  newBlockNumberBuffer,
        transactions: transactions
      }
      const block = new Block(blockData); 
      
      let queryAll = [
        { type: 'put', key: 'lastBlockNumber', value: block.blockNumber },
        { type: 'put', key: Buffer.concat([blockPrefix, block.blockNumber]), value: block.getRlp() }
      ];
      
      for (let tx in block.transactions) {
        let utxoPrevBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(tx.prev_block), blockNumberLength);
        let txRlp = tx.getRlp(outputIndex);
        let utxoNewKey = Buffer.concat([utxoPrefix, block.blockNumber, tx.token_id]);
        let utxoOldKey = Buffer.concat([utxoPrefix, utxoPrevBlockNumberBuffer, tx.token_id]);
        
        queryAll.push({ type: 'del', key: utxoOldKey });
        queryAll.push({ type: 'put', key: utxoNewKey, value: txRlp });
      }
      
      await levelDB.batch(queryAll);
      
      this.transactions = this.transactions.slice(txCount);
      this.newBlockNumber = this.newBlockNumber.add(new BN(config.contractblockStep));
      this.newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(this.newBlockNumber), blockNumberLength);
      console.log('New block created: ', this.newBlockNumber.toString(), ' ', 'transactions: ', txCount);

      return true;
    }
    catch(err){
      logger.error('createNewBlock error ', err);
    }
  }
};

const txPool = new TXPool();

export default txPool;
