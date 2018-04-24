'use strict';

const crypto = require('crypto');

const tx = require("./transaction");
const utils = require("./utils");
const Merkle = require("./merkle");

class Block {
    constructor(blockNumber, previousHash, transactions) {
        let data = [];
        transactions.forEach(tx => data.push(tx.toString(true)));

        this.blockHeader = new BlockHeader(blockNumber, previousHash, data);
        this.transactions = transactions;
    }

    get hash() {
        return crypto.createHash('sha256').update(this.toString()).digest('hex');
    }

    toString() {
        let txsHex = "";
        this.transactions.forEach(tx => txsHex += tx);
        return this.blockHeader.toString(true) + txsHex;
    }

    printBlock() {
        return {
            'blockNumber': this.blockHeader.blockNumber,
            'previousHash': this.blockHeader.previousHash,
            'merkleRoot': this.blockHeader.merkleRoot,
            'signature': this.blockHeader.sigR + this.blockHeader.sigS + this.blockHeader.sigV,
            'transactions': this.transactions.filter(tx => tx.length > 0)
        };
    }
}

class BlockHeader {
    constructor(blockNumber, previousHash, data) {
        this.blockNumber = blockNumber;  // 32 bytes
        this.previousHash = previousHash;  // 32 bytes
        if (blockNumber == 0) {
            this.merkle = null;
            this.merkleRoot = "";
        } else {
            this.merkle = new Merkle(data);
            this.merkle.makeTree();
            this.merkleRoot = this.merkle.getRoot().toString('hex');  // 32 bytes
        }
    }

    toString(includingSig) {
        let blkNumHexString = this.blockNumber.toString(16).padStart(64, "0");
        let rawBlockHeader = blkNumHexString + this.previousHash + this.merkleRoot;
        if (includingSig) {
            rawBlockHeader += this.sigR + this.sigS + this.sigV;
        }
        return rawBlockHeader;
    }
}



module.exports = {Block, BlockHeader};