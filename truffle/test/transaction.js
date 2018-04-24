'use strict';
const ethUtils = require('ethereumjs-util');
const createKeccakHash = require('keccak');
const RLP = require('rlp');
const utils = require("./utils");
const u = require("web3").utils;

class Transaction {
    constructor(blkNum1, txIndex1, oIndex1,
        blkNum2, txIndex2, oIndex2,
        newOwner1, denom1, newOwner2, denom2, fee, sig1, sig2, type) {
        // first input
        this.blkNum1 = blkNum1;
        this.txIndex1 = txIndex1;
        this.oIndex1 = oIndex1;
        this.sig1 = sig1;

        // second input
        this.blkNum2 = blkNum2;
        this.txIndex2 = txIndex2;
        this.oIndex2 = oIndex2;
        this.sig2 = sig2;

        // outputs
        this.newOwner1 = newOwner1;
        this.denom1 = denom1;
        this.newOwner2 = newOwner2;
        this.denom2 = denom2;

        this.fee = fee;
        this.type = type;
    }

    encode(includingSig) {
        let data = [
            this.blkNum1, this.txIndex1, this.oIndex1,
            this.blkNum2, this.txIndex2, this.oIndex2,
            this.newOwner1, this.denom1, this.newOwner2, this.denom2, this.fee
        ];
        if (includingSig) {
            data.push(this.sig1);
            data.push(this.sig2);
        }
        return RLP.encode(data);
    }

    hash() {
        return u.sha3(this.encode(false))
    }

    sign1(key) {
        var rsv = ethUtils.ecsign(Buffer.from(u.hexToBytes(this.hash())) , Buffer.from(key) );
        this.sig1 = "0x" + ( Buffer.concat([new Buffer(rsv.r), new Buffer(rsv.s), new Buffer([rsv.v])]).toString('hex')); 
    }

    sign2(key) {
        var rsv = ethUtils.ecsign(Buffer.from(u.hexToBytes(this.hash())) , Buffer.from(key) );
        this.sig2 = "0x" + ( Buffer.concat([new Buffer(rsv.r), new Buffer(rsv.s), new Buffer([rsv.v])]).toString('hex')); 
    }   
    
    confirm(root, key) {
        var rsv = ethUtils.ecsign(Buffer.from(u.hexToBytes(u.soliditySha3( this.hash(), root))), Buffer.from(key) );
        return "0x" + ( Buffer.concat([new Buffer(rsv.r), new Buffer(rsv.s), new Buffer([rsv.v])]).toString('hex')); 
    }

    toString(includingSig) {
        return this.encode(includingSig).toString('hex');
    }

    merkleHash() {
        if (!this.sig1) {
            this.sig1 = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
        }
        if (!this.sig2) {
            this.sig2 = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
        }
        return u.soliditySha3( this.hash() , this.sig1, this.sig2 ) 
    }
}

class UTXO {
    constructor(blkNum, txIndex, oIndex, owner, denom) {
        this.blkNum = blkNum;
        this.txIndex = txIndex;
        this.oIndex = oIndex;
        this.owner = owner;
        this.denom = denom;
    }
}

const TxType = {
    NORMAL: 0,
    DEPOSIT: 1,
    WITHDRAW: 2,
    MERGE: 3
};

module.exports = {Transaction, UTXO };