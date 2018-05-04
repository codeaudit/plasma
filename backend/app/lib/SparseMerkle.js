'use strict';

import ethUtil from 'ethereumjs-util';

class Merkle {
  constructor (leaves) {
    this.leaves = leaves.map(leave => {
      return { key: this.hexToBin(leave.key) , hash: leave.value };
    });
    this.depth = 256;
    this.defaultHashes = [ethUtil.sha3(new Buffer(32))];
    
    for (let index = 0; index < this.depth - 1; index ++) {
      this.defaultHashes.push(ethUtil.sha3(Buffer.concat([ this.defaultHashes[index], this.defaultHashes[index] ])));
    }
  }

  buildTree() {
    var leafCount = this.leaves.length;

    if (leafCount > 0) {
      this.levels = [];
      this.levels.unshift(this.leaves);
      for (let level = 0; level < this.depth; level++) {
        let currentLevel = this.levels[0]; 
        let nextLevel = [];
        
        for (let index = 0; index < currentLevel.length; index ++) {
          let leaf = currentLevel[index];
          let leafKey = leaf.key;
          let isEvenLeaf = this.isEvenLeaf(leafKey);

          let neighborLeafKey = isEvenLeaf ? this.binStrIncrement(leafKey) : this.binStrDecrement(leafKey);
          let neighborLeaf = currentLevel.find(item => item.key == neighborLeafKey);
          let neighborLeafHash;
          if (!neighborLeaf) {
            neighborLeafHash = this.defaultHashes[index];
          } else {
            neighborLeafHash = neighborLeaf.hash;
          }

          let parentLeafKey = leafKey.slice(0, -1);

          if (!nextLevel.find(item => item.key == parentLeafKey)) {

            let parentLeafHash = isEvenLeaf ? ethUtil.sha3(Buffer.concat([ leaf.hash, neighborLeafHash ])) : ethUtil.sha3(Buffer.concat([ neighborLeafHash, leaf.hash ]));

            nextLevel.push({ key: parentLeafKey, hash: parentLeafHash });
          }
        }
        
        this.levels.unshift(nextLevel);
      }
    }
  }
  
  getProof(leaf) {
    if (this.levels.length < 256) {
      this.buildTree();
    }

    let proof = [];
    let leafKey = this.hexToBin(leaf.key);

    for (let level = this.depth; level >= 1; level--) {

      let currentKey = leafKey.slice(0, level);
      let isEvenLeaf = this.isEvenLeaf(currentKey);

      let neighborLeafHash;
      let neighborLeafKey = isEvenLeaf ? this.binStrIncrement(currentKey) : this.binStrDecrement(currentKey);
      
      let currentLevels = this.levels[level - 1];
      
      let neighborLeaf = currentLevels.find(item => item.key == neighborLeafKey);
      if (!neighborLeaf) {
        neighborLeafHash = this.defaultHashes[level - 1];
      } else {
        neighborLeafHash = neighborLeaf.hash;
      }
      proof.push({ [isEvenLeaf ? 'right' : 'left']: neighborLeafHash });
    }

    return proof;
  }
  
  checkProof(proof, leafHash, merkleRoot) {
    let hash = leafHash;
    
    for (var level = 0; level < proof.length; level++) {
      let currentProofHash = proof[level];
      hash = currentProofHash.right ? ethUtil.sha3(Buffer.concat([ hash, currentProofHash.right ])) : ethUtil.sha3(Buffer.concat([ currentProofHash.left, hash ]))
    }
    
    return hash == merkleRoot;
  }
  
  isEvenLeaf(leafKey) {
    return leafKey[leafKey.length - 1] == '0';
  }
  
  
  hexToBin(str) {
    return str.split('').map(item => parseInt(item, 16).toString(2).padStart(4, '0')).join('');
  }
  
  binStrIncrement(str) {
    let done = false;
    let current = str.length - 1;
    str = str.split('');
    while (!done) {
      if (str[current] == '0') {
        str[current] = '1';
        done = true;
      } else {
        str[current--] = '0';
      }
    }
    return str.join('');
  }
  
  binStrDecrement(str) {
    let done = false;
    let current = str.length - 1;
    str = str.split('');
    while (!done) {
      if (str[current] == '1') {
        str[current] = '0';
        done = true;
      } else {
        str[current--] = '0';
      }
    }
    return str.join('');
  }
}


export default Merkle;
