'use strict';

var assert = require('assert');
import chai           from 'chai';
var expect = chai.expect;

import SparseMerkle   from '../app/lib/SparseMerkle';
import web3           from '../app/lib/web3';
import ethUtil        from 'ethereumjs-util';

function* getNextAddress(addresses) {
  let currentAddress = 0;
  let address;
  
  while(true) {
    if (!addresses[++currentAddress]) {
      currentAddress = 0;
    }
    if (address && addresses[currentAddress] == address) {
      if (!addresses[++currentAddress]) {
        currentAddress = 0;
        if (addresses[currentAddress] == address) {
          currentAddress++;
        }
      }
    }
    address = yield addresses[currentAddress];
  }
}

describe('ChildChain', () => {
  let accounts = [];
  
  it('should return test accounts list from ethernode keystore', async () => {
    accounts = await web3.eth.getAccounts();
    console.log('accounts', accounts);
    
    for (let addr of accounts) {
      await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
      console.log('unlockAccount', addr);
    }
    
    expect(accounts).to.have.lengthOf.above(1);
  })
  
  var nextAddressGen = getNextAddress(accounts);

});
