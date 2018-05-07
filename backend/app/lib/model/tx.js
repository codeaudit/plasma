'use strict';

import RLP from 'rlp';
const ethUtil = require('ethereumjs-util');
const BN = ethUtil.BN;

const transactionFields = [
  { name: 'prev_hash' },
  { name: 'prev_block' },
  { name: 'token_id' },
  { name: 'new_owner' },
  { name: 'signature' }
];

function initFields(self, fields, data) {
  if (data instanceof Buffer) {
    let decodedData = RLP.decode(data);
    fields.forEach((field, i) => {
      self[field.name] = decodedData[i];
    });
  } else if (Array.isArray(data) && data.length) {
    fields.forEach((field, i) => {
      self[field.name] = data[i];
    });
  }  else if (data && typeof data === 'object') {
    fields.forEach(field => {
      let value;
      if (data && data[field.name]) {
        value = field.type == 'bn' ? new BN(data[field.name]) : data[field.name];
      } else {
        value = field.default;
      }
      self[field.name] = value;
    });
  }
}

class PlasmaTransaction {
  constructor (data) {
    data = data || {};

    initFields(this, transactionFields, data);
  }

  getRlp(excludeSignature) {
    let dataToEncode = [
      this.prev_hash instanceof Buffer ? this.prev_hash : ethUtil.addHexPrefix(this.prev_hash),
      this.prev_block,
      ethUtil.toBuffer(this.token_id),
      this.new_owner
    ];
    if (!(excludeSignature)) {
      dataToEncode.push(this.signature);
    }

    this._rlp = RLP.encode(dataToEncode);
    return this._rlp;
  }

  getHash(excludeSignatures) {
    this._hash = ethUtil.sha3(this.getRlp(excludeSignatures));
    return this._hash;
  }

  getRaw() {
    return transactionFields.map(field => this[field.name]);
  }

  getAddressFromSignature(hex) {
    let txRlpEncoded = this.getHash(true);
    let txRlpHashed = ethUtil.hashPersonalMessage(txRlpEncoded);
    if (this.signature) {
      let { v, r, s } = ethUtil.fromRpcSig(ethUtil.addHexPrefix(this.signature));
      let publicAddress = ethUtil.ecrecover(Buffer.from(txRlpHashed, 'hex'), v, r, s);
      let address = ethUtil.pubToAddress(publicAddress);
      if (hex) {
        address = ethUtil.bufferToHex(address);
      }
      return address;
    }
    return null;
  }

  validate () {
    let isValid = true;
    if (this.signature && !this.getAddressFromSignature()) {
      isValid = false;
    }
    return isValid;
  }

  getMerkleHash() {
    if (!this.signature) {
      this.signature = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    }
    return ethUtil.sha3(Buffer.concat([ this.getHash(true), ethUtil.toBuffer(this.signature) ]));
  }

  getJson() {
    let data = {};
    data.prev_block = ethUtil.bufferToInt(this.prev_block.toString());
    data.token_id = this.token_id.toString();
    data.new_owner = ethUtil.addHexPrefix(this.new_owner.toString('hex'));
    data.signature = ethUtil.addHexPrefix(this.signature.toString('hex'));

    return data;
  }
}

module.exports = { PlasmaTransaction };
