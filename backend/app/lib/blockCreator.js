'use strict';

import config from "../config";
const { prefixes: { blockPrefix, transactionPrefix, utxoPrefix, lastBlockSubmittedToParentPrefix } } = config;
import { logger } from 'lib/logger';

const utxoIncludingAddressPrefix = config.utxoIncludingAddressPrefix;
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

class BlockCreator {
  constructor () {
  }

  start() {
    this.initBlockPeriodicalCreation();
    this.startBlockSubmittingToParent();
    this.startCheckingContractForEvents();
  }
    
  startCheckingContractForEvents() {
    let lastBlock;
    let lastProcessedBlock;
    
    return levelDB.get(config.prefixes.lastEventProcessedBlockPrefix)
      .then((res) => {
        lastProcessedBlock = Web3.utils.toBN(ethUtil.addHexPrefix(res.toString('hex'))).toNumber();
        this.processPeriodicalBlockEventsCheck(lastProcessedBlock);
      })
      .catch((err) => {
        logger.error('Periodical Events Check err', err);
        lastProcessedBlock = 0;
        this.processPeriodicalBlockEventsCheck(lastProcessedBlock);
    });
  }
  
  

  
  async initBlockPeriodicalCreation() {
    const newBlock = await txPool.createNewBlock();
    setTimeout(() => this.initBlockPeriodicalCreation(), blockCreationPeriod)
    return true;
  }
  
  async processPeriodicalBlockEventsCheck(previousBlockNumber) {
    try{
      let lastblock = await web3.eth.getBlockNumber();
      if (lastblock > previousBlockNumber) {
        lastblock = previousBlockNumber + 1;
        await this.processBlock(lastblock);
        setTimeout(() => this.processPeriodicalBlockEventsCheck(lastblock), 50);
        return;
      } else {
        setTimeout(() => this.processPeriodicalBlockEventsCheck(lastblock), 1000);
        return;
      }
    }
    catch(error) {
      logger.error("processPeriodicalBlockEventsCheck error " + error);
      setTimeout(() => this.processPeriodicalBlockEventsCheck(previousBlockNumber), 0);
    }
  }
  
  async processBlock(blockNumber) {
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
  
  async startBlockSubmittingToParent() {
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
        return setTimeout(() => this.startBlockSubmittingToParent(), 10000);
      }
      lastSubmittedBlock = lastSubmittedBlock.add(new BN(config.contractblockStep));
      
      await this.startBlockSubmit(lastSubmittedBlock);

      setTimeout(() => this.startBlockSubmittingToParent(), 10000);
    }
    catch(error) {
      if (!error.notFound) {
        logger.error('submiting block error ', error);
      }
      setTimeout(() => this.startBlockSubmittingToParent(), 10000);
    }
  }
  
  async startBlockSubmit(blockNumber) {
    let blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(blockNumber)), blockNumberLength);
    let blockKey = Buffer.concat([blockPrefix, blockNumberBuffer]);
    let blockBin = await levelDB.get(blockKey);
    let block = new Block(blockBin);
    let blockMerkleRootHash = ethUtil.addHexPrefix(block.merkleRootHash.toString('hex'));

    await web3.eth.personal.unlockAccount(plasmaOperatorAddress, config.plasmaOperatorPassword, 60);
    let gas = await contractHandler.contract.methods.submitBlock(blockMerkleRootHash).estimateGas({from: plasmaOperatorAddress});

    let res = await contractHandler.contract.methods.submitBlock(blockMerkleRootHash).send({from: plasmaOperatorAddress, gas});
    logger.info('Submitetd block ', blockNumber.toString());

    await levelDB.put(lastBlockSubmittedToParentPrefix, blockNumberBuffer);
  } 
}

const blockCreator = new BlockCreator;

export default blockCreator;