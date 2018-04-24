'use strict';

import config from "../config";
const { prefixes: { blockPrefix, transactionPrefix, utxoPrefix, lastBlockSubmittedToParentPrefix } } = config;
import { logger } from 'lib/logger';

const utxoIncludingAddressPrefix = config.utxoIncludingAddressPrefix;
const makeAddressIndex = config.makeAddressIndex;
const blockCreationPeriod = config.blockCreationPeriod;

import txPool from 'lib/txPool';
import levelDB from 'lib/db';
import contractHandler from 'lib/contracts/plasma';
import depositEventHandler from 'lib/handlers/DepositEventHandler';

import { blockNumberLength, txNumberLength, txOutputNumberLength } from 'lib/dataStructureLengths';

const Web3 = require('web3');
import web3 from 'lib/web3';
import Block from 'lib/model/block';

const ethUtil = require('ethereumjs-util'); 
const BN = ethUtil.BN;
const plasmaOperatorAddress = config.plasmaOperatorAddress;

export default function initMiner () {
  let lastBlock;
  let lastProcessedBlock;
  
  initBlockPeriodicalCreation();
  startBlockSubmittingToParent();

  levelDB.get(config.prefixes.lastEventProcessedBlockPrefix)
    .then((res) => {
      lastProcessedBlock = Web3.utils.toBN(ethUtil.addHexPrefix(res.toString('hex'))).toNumber();
      processPeriodicalBlockEventsCheck(lastProcessedBlock)();
    })
    .catch((err) => {
      lastProcessedBlock = 0;
      processPeriodicalBlockEventsCheck(lastProcessedBlock)();
  });
  
  async function initBlockPeriodicalCreation() {
    const created = await createNewBlock();
    setTimeout(initBlockPeriodicalCreation, blockCreationPeriod)
    return true;
  }
  
  function processPeriodicalBlockEventsCheck(previousBlockNumber) {
    return async function() {
      try{
        let lastblock = await web3.eth.getBlockNumber();
        if (lastblock > previousBlockNumber) {
          lastblock = previousBlockNumber + 1;
          await processBlock(lastblock)();
          setTimeout(processPeriodicalBlockEventsCheck(lastblock), 200);
          return;
        } else {
          setTimeout(processPeriodicalBlockEventsCheck(lastblock), 1000);
          return;
        }
      }
      catch(error) {
        logger.error("processPeriodicalBlockEventsCheck error " + error);
        setTimeout(processPeriodicalBlockEventsCheck(previousBlockNumber), 0);
      }
    }
  }
  
  function processBlock(blockNumber) {
    return async function() {
      const depositEventsInBlock = await contractHandler.contract.getPastEvents("Deposit", {
        fromBlock: blockNumber,
        toBlock: blockNumber
      });

      if (depositEventsInBlock.length > 0) {
        for (let i = 0, length = depositEventsInBlock.length; i< length; i++){
          await depositEventHandler(depositEventsInBlock[i]);
        }
      }
      
      const blockNumberBN = Web3.utils.toBN(blockNumber);
      const newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(blockNumberBN), blockNumberLength);
      await levelDB.put(config.prefixes.lastEventProcessedBlockPrefix, newBlockNumberBuffer);
    }
  } 

  async function createNewBlock() {
    try{
      try{
        lastBlock = await levelDB.get('lastBlockNumber');
      }
      catch(error) {
        lastBlock = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(0)),blockNumberLength);
        await levelDB.put('lastBlockNumber', lastBlock);
      }
      
      let txCount;
      let transactions;
      
      if (txPool.length == 0) {
        return false;
      }
      if (txPool.length > 2**16){
        txCount = 2**16;
      } else {
        txCount = txPool.length;
      }

      transactions = await txPool.getTransactionCheckInputs(txCount);

      if (transactions.length == 0) {
        return false;
      }
      
      const lastBlockNumber = Web3.utils.toBN(ethUtil.addHexPrefix(lastBlock.toString('hex')));
      const newBlockNumber = lastBlockNumber.add(new BN(config.contractblockStep));
      const newBlockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(newBlockNumber), blockNumberLength);
      const blockData = {
        blockNumber:  newBlockNumberBuffer,
        transactions: transactions
      }
      const block = new Block(blockData); 

      await saveBlock(block);
      txPool.removeTransactions(txCount);

      return true;
    }
    catch(err){
      logger.error('createNewBlock error ', err);
    }
  }     
  
  async function saveBlock(block) {
    let queryAll = [
      { type: 'put', key: 'lastBlockNumber', value: block.blockNumber },
      { type: 'put', key: Buffer.concat([blockPrefix, block.blockNumber]), value: block.getRlp() }
    ];
    block.transactions.forEach((tx, txIndexInBlock)=> {    
      let txIndexInBlockBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(txIndexInBlock)), txNumberLength);
      for (let inputIndex of [1, 2]) {
        let input = tx.getTransactionInput(inputIndex);
        if (!!input) {
          let keyUTXO = Buffer.concat([utxoPrefix, input[0], input[1], input[2]]);
          queryAll.push({ type: 'del', key: keyUTXO });
        }
      }
      
      for (let outputIndex of [1, 2]) {
        let outputRlp = tx.getTransactionOutputRlp(outputIndex);
        if (outputRlp) {
          let outputNumberInTxBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(outputIndex)),txOutputNumberLength)
          let keyUTXO = Buffer.concat([utxoPrefix, block.blockNumber, txIndexInBlockBuffer, outputNumberInTxBuffer]);
          queryAll.push({ type: 'put', key: keyUTXO, value: outputRlp });
        }
      }
      
      queryAll.push({ type: 'put', key: Buffer.concat([transactionPrefix, block.blockNumber, txIndexInBlockBuffer]), value: tx.getRlp() });
    })

    await levelDB.batch(queryAll);
  }
  
  async function startBlockSubmittingToParent() {
    try {
      let lastSubmittedBlock;
      let currentBlockInParent = await contractHandler.contract.methods.currentBlock().call();
      currentBlockInParent = Web3.utils.toBN(currentBlockInParent);

      try {
        lastSubmittedBlock = await levelDB.get(lastBlockSubmittedToParentPrefix);
      }  catch(error) {
        lastSubmittedBlock = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(0)),blockNumberLength);
      }
      lastSubmittedBlock = Web3.utils.toBN(ethUtil.addHexPrefix(lastSubmittedBlock.toString('hex')));

      if (!currentBlockInParent.gt(lastSubmittedBlock)) {
        return setTimeout(startBlockSubmittingToParent, 10000);
      }
      lastSubmittedBlock = lastSubmittedBlock.add(new BN(config.contractblockStep));
      
      await processBlockForSubmission(lastSubmittedBlock);

      setTimeout(startBlockSubmittingToParent, 10000);
    }
    catch(error) {
      if (!error.notFound) {
        logger.error('submiting block error ', error);
      }
      setTimeout(startBlockSubmittingToParent, 10000);
    }
  }
  
  async function processBlockForSubmission(blockNumber) {
    let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(blockNumber)), blockNumberLength);
    let blockKey = Buffer.concat([blockPrefix, blockNumberBuffer]);
    let blockBin = await levelDB.get(blockKey);
    let block = new Block(blockBin);
    let blockMerkleRootHash = ethUtil.addHexPrefix(block.merkleRootHash.toString('hex'));

    await web3.eth.personal.unlockAccount(plasmaOperatorAddress, config.plasmaOperatorPassword, 60);
    let gas = await contractHandler.contract.methods.submitBlock(blockMerkleRootHash).estimateGas({from: plasmaOperatorAddress});

    let res = await contractHandler.contract.methods.submitBlock(blockMerkleRootHash).send({from: plasmaOperatorAddress, gas});
    logger.info('submitetd block ', blockNumber);

    await levelDB.put(lastBlockSubmittedToParentPrefix, blockNumberBuffer);
  } 
}