'use strict';

const Web3 = require('web3');
const BN = Web3.utils.BN;
import config from "../../config";

import ethUtil from 'ethereumjs-util';
import RLP from 'rlp';
import levelDB from 'lib/db';
import web3 from 'lib/web3';

import { PlasmaTransaction } from 'lib/model/tx';

import { createDepositTransaction } from 'lib/tx';
import { logger } from 'lib/logger';
import txPool from 'lib/txPool';

async function processDepositEvent(event){
  const { depositor, amount, token_id } = event.returnValues;

  let tokenIdBN = new BN(token_id);
  let depositBlockIndexKey = Buffer.concat([config.prefixes.tokenIdPrefix, ethUtil.toBuffer(tokenIdBN)]);

  try {
    const existingdepositBlockIndex = await levelDB.get(depositBlockIndexKey);
    return true;
  }
  catch (error) {
    if (error.type !== "NotFoundError"){
      throw error;
    }
    await levelDB.put(depositBlockIndexKey, Buffer.alloc(1, "0x01", "hex"))  
  }
  
  const tx = await createDepositTransaction(depositor, new Web3.utils.BN(amount), tokenIdBN);

  let txRlpEncoded = tx.getHash(true).toString('hex');
  const signature = ethUtil.ecsign(Buffer.from(txRlpEncoded, 'hex'), Buffer.from(config.plasmaOperatorKey, 'hex'));
  let signatureRaw = ethUtil.toRpcSig(signature.v, signature.r, signature.s);

  tx.signature = signatureRaw;

  if (tx.validate()) {
    txPool.addTransaction(tx);
    logger.info('Create deposit transaction ', token_id);        
  }
  else {
    logger.error('Deposit TX error ');        
  }
}


export default processDepositEvent;
