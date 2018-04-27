'use strict';

import Block from 'lib/model/block';
import config from "../config";
import Web3 from 'web3';
import ethUtil from 'ethereumjs-util'; 
const BN = ethUtil.BN;
import RLP from 'rlp';

import levelDB from 'lib/db';
import { logger } from 'lib/logger';
import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';
import { checkTransactionInputs, getUTXO } from 'lib/tx';
const { prefixes: { blockPrefix, transactionPrefix, utxoPrefix, lastBlockSubmittedToParentPrefix } } = config;
import { TransactionOutput } from 'lib/model/output';
import { getAllUxtos } from 'lib/helpers/utxo';

const depositInputKey = new Buffer(blockNumberLength + txNumberLength + txOutputNumberLength).toString('hex');

class TXPool {
  constructor () {
    this.transactions = [];
    this.newBlockNumber;
    this.newBlockNumberBuffer;
    this.inputKeys = {};
    this.currentTransactionNumberInBlock = 0;
    
    
    this.txPool = [];
    this.processing = false;
    
    
    this.utxos = {};
    this.spendedUtxosFromDb = {};
  }

  get length() {
    return this.transactions.length;
  }
  
  get poolLength() {
    return this.txPool.length;
  }

  async addTransaction(tx) {
    this.txPool.push(tx);

    if (!this.processing) {
      this.processTransactions();
    }
  }
  
  async processTransactions() {
    try {
      this.processing = true;
      if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
        await this.getLastBlockNumberFromDb();
      }
      
      while (this.txPool.length) {
        let tx = this.txPool.shift();
        let inputsData = await this.checkTxInputs(tx);
        
        if (inputsData) {
          this.updateUxtos(inputsData, ++this.currentTransactionNumberInBlock);
          this.transactions.push(tx);
        }
      }
      this.processing = false;
    }
    catch (error) {
      this.processing = false;
      console.log('processTransactions error==========================', error);
    }
  }
    
  updateUxtos(inputsData, transactionNumberInBlock) {
    let { transactionInputs = [], transactionOutputs = []} = inputsData;
    if (Array.isArray(transactionInputs)) {
      transactionInputs.forEach(input => {
        if (input && input.utxo) {
          if (input.fromDatabase) {
            this.spendedUtxosFromDb[input.utxoKey.toString('hex')] = true;
          } else {
            delete this.utxos[input.utxoKey.toString('hex')];
          }
        }
      })
    }
        
    let txIndexInBlockBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(transactionNumberInBlock)), txNumberLength);
    if (Array.isArray(transactionOutputs)) {
      transactionOutputs.forEach((output, index) => {
        if (output && output.output) {
          let outputNumberInTxBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(index + 1)), txOutputNumberLength)
          let utxoKey = Buffer.concat([utxoPrefix, this.newBlockNumberBuffer, txIndexInBlockBuffer, outputNumberInTxBuffer]);
          this.utxos[utxoKey.toString('hex')] = output.output;
        }
      })
    }
  }

  async checkTxInputs(transaction) {
    try {
      let txInputKeys = transaction.getInputKeys();
      if (txInputKeys.join('') == depositInputKey + depositInputKey) {
        let address1 = transaction.getAddressFromSignature(1, true).toLowerCase();
        let address2 = transaction.getAddressFromSignature(2, true).toLowerCase();  
        let valid = address1 == address2 && config.plasmaOperatorAddress.toLowerCase() == address1;
        if (!valid) {
          return false;
        }
        
        let transactionOutputs = [];
        for (let outputIndex of [1, 2]) {
          let output = transaction.getTransactionOutput(outputIndex);
          if (output) {        
            output =  new TransactionOutput(output);
            transactionOutputs.push({ output });
          }
        }   
        return { transactionOutputs };
      }
      
      let inputsTotalAmount = new BN(0);
      let outputsTotalAmount = new BN(0);
      let transactionInputs = [];
      let transactionOutputs = [];

      for (let inputIndex of [1, 2]) {
        let input = transaction.getTransactionInput(inputIndex);
        if (input) {
          let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[0]), blockNumberLength);
          let txNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[1]), txNumberLength);
          let txOutputNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[2]), txOutputNumberLength);
          let utxoKey = Buffer.concat([utxoPrefix, blockNumberBuffer, txNumberBuffer, txOutputNumberBuffer]);

          let utxo = this.utxos[utxoKey.toString('hex')];
          if (!utxo) {
            if (!this.spendedUtxosFromDb[utxoKey.toString('hex')]) {
              utxo = await this.getUTXOFromDatabaseByKey(utxoKey);
            }
            if (!utxo) {
              return false;
            }
            transactionInputs.push({ utxo, utxoKey, fromDatabase: true });
          } else {
            transactionInputs.push({ utxo: utxo, utxoKey });
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
        if (output && output[1]) {
          output = new TransactionOutput(output);
          outputsTotalAmount = outputsTotalAmount.add(output.denom);
          transactionOutputs.push({ output });
        }
      }      

      if (!inputsTotalAmount.eq(outputsTotalAmount)) {
        return false;
      }
      
      return { transactionInputs, transactionOutputs };
    }
    catch (error) {
      console.log('checkTransactionInputs   error  ', error);
      return false;
    }
  }
  
  async getUTXOFromDatabaseByKey(utxoKey) {
    try {
      let data = await levelDB.get(utxoKey);
      return new TransactionOutput(data);
    }
    catch(err) {
      return null;
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
      
      Object.keys(this.utxos).forEach(uxtoKey => {
        let output = this.utxos[uxtoKey];
        let outputRlp = output.getRlp();
        queryAll.push({ type: 'put', key: Buffer.from(uxtoKey, 'hex'), value: outputRlp });
        delete this.utxos[uxtoKey];
      })
      
      Object.keys(this.spendedUtxosFromDb).forEach(uxtoKeyToDelete => {
        queryAll.push({ type: 'del', key: Buffer.from(uxtoKeyToDelete, 'hex') });
        delete this.spendedUtxosFromDb[uxtoKeyToDelete];
      })

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
          
  removeTransactions(txCount) {
    this.transactions = this.transactions.slice(txCount);
  }

  getTransaction(txCount) {
    return this.transactions.slice(0, txCount);
  }
  
  async getAllUxtos() {
    let utxos = await getAllUxtos({ includeKeys: true, json: true });
    utxos = utxos.filter(utxo => !this.spendedUtxosFromDb[utxo.key.toString('hex')]);
    
    let blockStart = utxoPrefix.length;
    let txStart = blockStart + blockNumberLength;
    let outputStart = txStart + txNumberLength;
    
    Object.keys(this.utxos).forEach(outputKey => {
      let output = this.utxos[outputKey];
      let outputKeyBuffer = Buffer.from(outputKey, 'hex');
      if (!output) {
        return;
      }

      let outputJson = output.getJson();
      outputJson.blockNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(blockStart, txStart));
      outputJson.txNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(txStart, outputStart));
      outputJson.outputNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(outputStart));

      utxos.push(outputJson);
    })
    return utxos;
  }
  
  async getUxtoFromPool(utxoKey) {
    try {
      let utxo = this.utxos[utxoKey.toString('hex')];
      if (!utxo) {
        if (!this.spendedUtxosFromDb[utxoKey.toString('hex')]) {
          utxo = await this.getUTXOFromDatabaseByKey(utxoKey);
        }
        if (!utxo) {
          return false;
        }
        return new TransactionOutput(utxo);
      }
      
      return utxo;
    }
    catch(err) {
      return null;
    }
  }
  
};

const txPool = new TXPool();

export default txPool;
