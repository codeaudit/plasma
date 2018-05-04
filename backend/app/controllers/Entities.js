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

import Block from 'lib/model/block';
const { prefixes: { utxoPrefix } } = config;

import {
  txNumberLength,
  txOutputNumberLength,
  blockNumberLength
} from 'lib/dataStructureLengths';

import SparseMerkle from 'lib/SparseMerkle';


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
      const start = Buffer.concat([config.prefixes.tokenIdPrefix, Buffer.alloc(1)]);
      const end = Buffer.concat([config.prefixes.tokenIdPrefix, Buffer.from("ff".repeat(1), 'hex')]);

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
