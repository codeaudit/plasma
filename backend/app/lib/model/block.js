'use strict';

import MerkleTools from 'merkle-tools';

import { PlasmaTransaction } from 'lib/model/tx';
import RLP from 'rlp';
import ethUtil from 'ethereumjs-util';

class Block {
  constructor (data) {
    if (Buffer.isBuffer(data)) {
      let decodedData = RLP.decode(data);
      this.blockNumber = decodedData && decodedData[0];
      this.merkleRootHash = decodedData && decodedData[1];
      this.transactions = decodedData && decodedData[2];
    } else if (data && typeof data === 'object') {
      this.blockNumber = data.blockNumber;
      this.transactions = data.transactions || [];

      let merkle = new MerkleTools({ hashType: 'SHA3-256' });
      for (let i = 0, l = this.transactions.length; i < l; i++) {
        let tx = this.transactions[i];
        let txRlp = tx.getRlp();
        let encoded = ethUtil.sha3(txRlp);
        merkle.addLeaf(encoded);
      }
      merkle.makeTree(false);
      this.merkleRootHash = merkle.getMerkleRoot();
    }
  }

  getRlp() {
    if (this._rlp) {
      return this._rlp;
    }
    let transactions = this.transactions;
    if (transactions[0] && transactions[0] instanceof PlasmaTransaction) {
      transactions = transactions.map(tx => tx.getRaw());
    }

    this._rlp = RLP.encode([this.blockNumber, this.merkleRootHash, transactions]);
    return this._rlp;
  }

  toJson() {
    let data = [
      this.blockNumber,
      this.merkleRootHash,
      this.transactions
    ];

    return ethUtil.baToJSON(data);
  }
  
  getJson() {
    let data = {
      blockNumber: ethUtil.bufferToInt(this.blockNumber.toString()),
      merkleRootHash: this.merkleRootHash.toString('hex'),
      transactions: []
    };
    let transactions = [];

    for (let txRlp of this.transactions) {
      let tx = new PlasmaTransaction(txRlp);
      data.transactions.push(tx.getJson());
    }
    return data;
  }
}

module.exports = Block;
