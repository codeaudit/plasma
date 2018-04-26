'use strict';

import Router from 'router';
const router = new Router();
import levelDB from 'lib/db';
import contractHandler from 'lib/contracts/plasma';
import web3     from 'lib/web3';
import RLP from 'rlp';
import config from "../config";
const ethUtil = require('ethereumjs-util'); 
const BN = ethUtil.BN;

import { TransactionInput } from 'lib/model/input';
import { TransactionOutput } from 'lib/model/output';
import Block from 'lib/model/block';
const { prefixes: { utxoPrefix } } = config;

import {
  txNumberLength,
  txOutputNumberLength,
  blockNumberLength
} from 'lib/dataStructureLengths';


router.route('/test')
  .get(async function(req, res, next) {
    try { 
      let test = 'c89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6';
      // let test1 = 'c89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6';

      // let testKeccak = 'c89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6';
      // let testKeccak = ethUtil.sha3(test);
      // let testKeccak = ethUtil.sha3(test);
      
      let testHashed =  ethUtil.hashPersonalMessage(Buffer.from(test, 'hex'));
      // const hash = ethUtil.hashPersonalMessage(dataBuffer);

      console.log('web3.eth.sign              ', web3.eth.sign);
      console.log('testHashed              ', testHashed);

      // console.log('config.plasmaOperatorAddress              ', config.plasmaOperatorAddress);

      await web3.eth.personal.unlockAccount(config.plasmaOperatorAddress, config.plasmaOperatorPassword, 60);
      const signature = await web3.eth.sign(ethUtil.addHexPrefix(test), config.plasmaOperatorAddress);
      console.log('signature              ', signature);
      let signatureRpc = ethUtil.fromRpcSig(ethUtil.addHexPrefix(signature));
      console.log('signatureRpc              ', signatureRpc);

      // let signatureRaw = ethUtil.toRpcSig(signature.v, signature.r. signature.s);
      
      let publicAddress = ethUtil.ecrecover(testHashed, signatureRpc.v, signatureRpc.r, signatureRpc.s);
      let address = ethUtil.bufferToHex(ethUtil.pubToAddress(publicAddress));
      console.log('address              ', address);
      console.log('plasmaOperatorAddress', config.plasmaOperatorAddress);

      return res.json(address);
    }
    catch(error){
      next(error);
    }
  })
  
router.route('/block/:id')
  .get(async function(req, res, next) {
    try { 
      const blockNumber = parseInt(req.params.id);
      if (!blockNumber){
          return res.json({error: true, reason: "invalid block number"});
      }
      
      const blockNumberBuffer = ethUtil.setLengthLeft(ethUtil.toBuffer(new BN(blockNumber)),blockNumberLength);
      const key = Buffer.concat([config.prefixes.blockPrefix, blockNumberBuffer]);
      const blockRlp = await levelDB.get(key);
      const block = new Block(blockRlp);
      let resJson = block.getJson();
      
      return res.json(resJson);
    }
    catch(error){
      return res.json({error: true, reason: "invalid block number"});
    }
  })


router.route('/deposit')
  .get(async function(req, res, next) {
    try { 
      const deposits = [];
      const start = Buffer.concat([config.prefixes.depositIndexPrefix, Buffer.alloc(1)]);
      const end = Buffer.concat([config.prefixes.depositIndexPrefix, Buffer.from("ff".repeat(1), 'hex')]);

      levelDB.createReadStream({gte: start, lte: end})
        .on('data', function (data) {
          deposits.push(data)
          
        })
        .on('error', function (error) {
            console.log('error', error)
        })
        .on('end', function () {
          res.json(deposits);
        })
    }
    catch(error){
      console.log('error', error);
    }
  })

router.route('/uxto')
  .get(async function(req, res, next) {
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
          
          let outputJson = output.getJson();
          outputJson.blockNumber = ethUtil.bufferToInt(data.key.slice(blockStart, txStart))
          outputJson.txNumber = ethUtil.bufferToInt(data.key.slice(txStart, outputStart))
          outputJson.outputNumber = ethUtil.bufferToInt(data.key.slice(outputStart))

          uxtos.push(outputJson);
        })
        .on('error', function (error) {
            console.log('error', error);
        })
        .on('end', function () {
          res.json(uxtos);
        })
    }
    catch(error){
      console.log('error', error);
    }
  })

module.exports = router;
