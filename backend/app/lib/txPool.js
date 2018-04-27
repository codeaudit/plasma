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
  ///
  async addTransaction(tx) {
    this.txPool.push(tx);
    // console.log('addTransaction');
    // console.log('this.processing', this.processing);

    if (!this.processing) {
      // console.log('this. start processing');
      this.processTransactions_1();
    }
  }
  
  async processTransactions_1() {
    // console.log('tprocessTransactions_1 ');
    try {
      this.processing = true;
      // console.log('tprocessTransactions_1        1 ');

      if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
        await this.getLastBlockNumberFromDb();
      }
      
      while (this.txPool.length) {
        // console.log('this.txPool.length ', this.txPool.length);

        let tx = this.txPool.shift();
        let inputsData = await this.checkTxInputs(tx);
        
        if (inputsData) {
          // console.log('addTransaction inputsData =========================  ok    ==================================================', );
          // this.updateUxtos(inputsData);
          this.updateUxtos(inputsData, ++this.currentTransactionNumberInBlock);

          // await this.updateTransactionUxtos(tx, ++this.currentTransactionNumberInBlock);
          // console.log('this.utxos              : ', this.utxos);
          // console.log('this.spendedUtxosFromDb : ', this.spendedUtxosFromDb);

          this.transactions.push(tx);
          // return true;
        }
      }
      this.processing = false;
    }
    catch (error) {
      this.processing = false;
      console.log('processTransactions error==========================', error);
    }
  }
  
  
  ///
  async addTransaction_(tx) {
    if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
      await this.getLastBlockNumberFromDb();
    }

    let inputsData = await this.checkTxInputs(tx);

    if (inputsData) {
      // console.log('addTransaction inputsData =========================  ok    ==================================================', );
      // this.updateUxtos(inputsData);
      this.updateUxtos(inputsData, ++this.currentTransactionNumberInBlock);

      // await this.updateTransactionUxtos(tx, ++this.currentTransactionNumberInBlock);
      // console.log('this.utxos              : ', this.utxos);
      // console.log('this.spendedUtxosFromDb : ', this.spendedUtxosFromDb);
      // console.log('transactions push  txNumber1--------------------------------------', tx.txNumber1);

      this.transactions.push(tx);
      return true;;
    }
    // console.log('addTransaction !inputsData =============================000000000000000000=========================================================================', );


    return false;
  }
  
  updateUxtos(inputsData, transactionNumberInBlock) {
    // console.log('updateUxtos77777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777')
    // console.log('utxos --------------------------------------', this.utxos);

    //
    let inputCount = 0;
    let outputCount = 0;
    //
    let { transactionInputs = [], transactionOutputs = []} = inputsData;
    if (Array.isArray(transactionInputs)) {
      transactionInputs.forEach(input => {
        if (input && input.utxo) {
          // console.log('input --------------------------------------', input);
          // console.log('input --key------------------------------------', input.utxoKey.toString('hex'));

          if (input.fromDatabase) {
            this.spendedUtxosFromDb[input.utxoKey.toString('hex')] = true;
            inputCount++;
          } else {
            delete this.utxos[input.utxoKey.toString('hex')];
            inputCount++;
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
          // console.log('utxoKey  1----------------  ', utxoKey);
          // 
          // console.log('newBlockNumberBuffer  1----------------  ', new BN(this.newBlockNumberBuffer).toString());
          // console.log('txIndexInBlockBuffer  1----------------  ', new BN(txIndexInBlockBuffer).toString());
          // console.log('outputNumberInTxBuffer  1----------------  ', new BN(outputNumberInTxBuffer).toString());
          // console.log('transactionOutputs  output----------------  ', 'i: ', index, '  ' , output);
          // console.log('output --key------------------------------------', utxoKey.toString('hex'));

          this.utxos[utxoKey.toString('hex')] = output.output;
          outputCount++
        }
      })
    }
    
    if (inputCount != outputCount) {
      // console.log('=============================================================inputCount===============================', inputCount);
      // console.log(inputsData);
      // 
      // console.log('=============================================================outputCount==============================', outputCount);
    }
    
    if (Object.keys(this.utxos).length > 1) {
      // console.log('utxos length  --------------------------------------', this.utxos);
      // console.log(inputsData);

    }
    // console.log('utxos --------------------------------------', this.utxos);
    // 
    // console.log('updateUxtos77777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777')
  }

  async checkTxInputs(transaction) {
    try {
      let txInputKeys = transaction.getInputKeys();
      if (txInputKeys.join('') == depositInputKey + depositInputKey) {
        // console.log('checkTransactionInputs  1----------------  ',);
        let address1 = transaction.getAddressFromSignature(1, true).toLowerCase();
        let address2 = transaction.getAddressFromSignature(2, true).toLowerCase();
        // console.log('address                  ', address1);
        // console.log('plasmaOperatorAddress    ', config.plasmaOperatorAddress.toLowerCase());
        
        let valid = address1 == address2 && config.plasmaOperatorAddress.toLowerCase() == address1;
        if (!valid) {
          // console.log('checkTxInputs  1--------------------------------------------------  ',);

          return false;
        }
        
        let transactionOutputs = [];
        for (let outputIndex of [1, 2]) {
          let output = transaction.getTransactionOutput(outputIndex);
          if (output) {        
            output =  new TransactionOutput(output);
            // console.log('output   deposit----------------  ', output);
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
          // console.log('getTransactionInput  1----------------  ', input);

          let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[0]), blockNumberLength)
          let txNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[1]), txNumberLength)
          let txOutputNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(input[2]), txOutputNumberLength)
          // console.log('utxoKey blockNumberBuffer----------------  ', blockNumberBuffer);
          // console.log('utxoKey txNumberBuffer----------------  ', txNumberBuffer);
          // console.log('utxoKey txOutputNumberBuffer----------------  ', txOutputNumberBuffer);

          let utxoKey = Buffer.concat([utxoPrefix, blockNumberBuffer, txNumberBuffer, txOutputNumberBuffer]);
          // console.log('utxoKey  1----------------  ', utxoKey);
          // console.log('utxoKey  1-111111111---------------  ', utxoKey.toString('hex'));
          // console.log('this.utxos  1----------------  ', this.utxos);

          let utxo = this.utxos[utxoKey.toString('hex')];
          if (!utxo) {
            if (!this.spendedUtxosFromDb[utxoKey.toString('hex')]) {
              // console.log('getUTXOByKey !utxoKey======================================================================', utxoKey);
              utxo = await this.getUTXOByKey(utxoKey);
            }
            if (!utxo) {
              // console.log('checkTxInputs  !utxo  ',);
              return false;
            }
            transactionInputs.push({ utxo, utxoKey, fromDatabase: true });
          } else {
            transactionInputs.push({ utxo: utxo, utxoKey });
            // utxo = new TransactionOutput(utxo.output);
          } 
          
          // console.log('getUTXOByKey------------------------- ', utxo);

          let address = transaction.getAddressFromSignature(inputIndex);
          address = ethUtil.addHexPrefix(address.toString('hex').toLowerCase());
          let newowner = ethUtil.addHexPrefix(utxo.newowner.toString('hex').toLowerCase());
          // console.log('address     ', address);
          // console.log('newowner    ', newowner);
          
          if (address != newowner) {
            // console.log('checkTransactionInputs  2----------------  ',);

            return false;
          }
          inputsTotalAmount = inputsTotalAmount.add(new BN(utxo.denom));
        }
      }
      
      for (let outputIndex of [1, 2]) {
        let output = transaction.getTransactionOutput(outputIndex);
        // console.log('output   2----------------  ', output);

        // output =  new TransactionOutput(output);

        if (output && output[1]) {
          output = new TransactionOutput(output);
          // console.log('output   3----------------  ', output);
          outputsTotalAmount = outputsTotalAmount.add(output.denom);
          transactionOutputs.push({ output });
        }
      }      

      if (!inputsTotalAmount.eq(outputsTotalAmount)) {
        // console.log('checkTransactionInputs   3----------------  ',);
        // console.log('inputsTotalAmount-------------==----', inputsTotalAmount.toString());
        // console.log('outputsTotalAmount----------==-------', outputsTotalAmount.toString());
        return false;
      }
      
      return { transactionInputs, transactionOutputs };
    }
    catch (error) {
      console.log('checkTransactionInputs   error  ', error);
      return false;
    }
  }
  
  async getUTXOByKey(utxoKey) {
    try {
      
      let data = await levelDB.get(utxoKey);
      return new TransactionOutput(data);
    }
    catch(err) {
      // console.log('getUTXOByKey !er=======================================================================', err);
      return null;
    }
  }
  /*
  async addTransaction_pool(tx) {
    this.txPool.push(tx);
    
    if (!this.processing) {
      // console.log('this. start processing');
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
        // console.log('this.txPool.length ', this.txPool.length);

        let tx = this.txPool.shift();
        let isValid = await checkTransactionInputs(tx);
        if (isValid) {
          let updated = await this.updateTransactionUxtos(tx, ++this.currentTransactionNumberInBlock);
          if (updated) {
            this.transactions.push(tx);
          }
        } else {
          console.log('addTransaction invalid - - - - - - - - - - - - - - - - - - - - -  ',);
        }
      }
      this.processing = false;
    }
    catch (error) {
      this.processing = false;
      console.log('processTransactions error==========================', error);
    }
  }
  */
  async addTransaction1(tx) {
    if (!this.newBlockNumber || !this.newBlockNumberBuffer) {
      await this.getLastBlockNumberFromDb();
    }

    let isValid = await checkTransactionInputs(tx);

    if (!isValid) {
      console.log('addTransaction invalid ==============================000======================================================================================',);

      await this.updateTransactionUxtos(tx, ++this.currentTransactionNumberInBlock);
      this.transactions.push(tx);
    }
    

    return true;
  }
  
  async updateTransactionUxtos(tx, transactionNumberInBlock) {
    try {
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
    catch (error) {
      console.log('update uxtos error==========================', error);
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
        console.log('createNewBlock-   length == 0 ----',)
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
      
      // console.log('save  block uxtoKey: --------', this.utxos);

      Object.keys(this.utxos).forEach(uxtoKey => {
        let output = this.utxos[uxtoKey];
        // console.log('New block uxtoKey: --------', uxtoKey);
        // console.log('New block uxtoKey: --------', Buffer.from(uxtoKey, 'hex'));
        // 
        // console.log('New block output: ---------', output);
        let outputRlp = output.getRlp();
        queryAll.push({ type: 'put', key: Buffer.from(uxtoKey, 'hex'), value: outputRlp });
        delete this.utxos[uxtoKey];
      })
      Object.keys(this.spendedUtxosFromDb).forEach(uxtoKeyToDelete => {
        queryAll.push({ type: 'del', key: Buffer.from(uxtoKeyToDelete, 'hex') });
        delete this.spendedUtxosFromDb[uxtoKeyToDelete];
      })
      // console.log('New block queryAll: ', queryAll);

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
    
  async createNewBlock1() {
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
  
  async getAllUxtos() {
    let utxos = await getAllUxtos({ includeKeys: true, json: true });
    utxos = utxos.filter(utxo => !this.spendedUtxosFromDb[utxo.key])
    
    let blockStart = utxoPrefix.length;
    let txStart = blockStart + blockNumberLength;
    let outputStart = txStart + txNumberLength;
    
    Object.keys(this.utxos).forEach(outputKey => {
      // console.log('outputKey----11-------------', outputKey)

      let output = this.utxos[outputKey];
      // console.log('output------11-----------', output)

      let outputKeyBuffer = Buffer.from(outputKey, 'hex');
      if (!output) {
        return;
      }
      // console.log('output----------------------', output)

      let outputJson = output.getJson();
      // console.log('outputJson-----------------', outputJson)

      outputJson.blockNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(blockStart, txStart));
      outputJson.txNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(txStart, outputStart));
      outputJson.outputNumber = ethUtil.bufferToInt(outputKeyBuffer.slice(outputStart));
      // console.log('outputJson-----------------', outputJson)

      utxos.push(outputJson);
    })
    return utxos;
  }
  
  async getUxtoFromPool(utxoKey) {
    try {
      // console.log('utxoKey  1----------------  ', utxoKey);

      let utxo = this.utxos[utxoKey.toString('hex')];
      if (!utxo) {
        if (!this.spendedUtxosFromDb[utxoKey.toString('hex')]) {
          utxo = await this.getUTXOByKey(utxoKey);
        }
        if (!utxo) {
          return false;
        }
        return new TransactionOutput(utxo);
      }
      
      // console.log('getUxtoFromPool----------------  ', utxo);

      return utxo;
    }
    catch(err) {
      // console.log('getUxtoFromPool-- err--------------  ', err);

      return null;
    }
  }
  
};

const txPool = new TXPool();

export default txPool;
