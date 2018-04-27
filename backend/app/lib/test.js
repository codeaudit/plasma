
import depositEventHandler from 'lib/handlers/DepositEventHandler';
import { createSignedTransaction } from 'lib/tx';
import levelDB from 'lib/db';
import web3     from 'lib/web3';
import Promise from 'bluebird';
import {
  txNumberLength,
  txOutputNumberLength,
  blockNumberLength
} from 'lib/dataStructureLengths';
import config from "../config";
import { TransactionInput } from 'lib/model/input';
import { TransactionOutput } from 'lib/model/output';
const { prefixes: { utxoPrefix } } = config;
const ethUtil = require('ethereumjs-util'); 
import RLP from 'rlp';
import txPool from 'lib/txPool';
const BN = ethUtil.BN;
import contractHandler from 'lib/contracts/plasma';

// var accounts = {
//   1: {address:'0x11A618DE3ADe9B85Cd811BF45af03bAd481842Ed', pkey: ''},
//   2: {address:'0xA5Fe0dEda5E1a0FCc34B02B5BE6857e30C9023fE', pkey: ''},
// }

let statistic = {}

async function createDeposits(options = {}) {
  let accounts = await web3.eth.getAccounts();
  // accounts = accounts.map(address => address.toLowerCase());
  console.log('accounts', accounts);
  
  for (let addr of accounts) {
    await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
    console.log('unlockAccount', addr);
  }
  
  let deposits = options.deposits || 5;
  var nextAddressGen = getNextAddress(accounts);

  let created = 0;
  // await new Promise.all(new())
  // let query = [];
  for (let i = 0; i <= deposits; i++) {
    try {
      let address = nextAddressGen.next().value;
      let amount = new BN('100000000000000000');
      console.log('amount1', amount);
      let add = new BN('1000000000000000');
      console.log('add', add);
      add = add.mul(new BN(i + 1));
      console.log('add1', add);

      amount = amount.add(add).toString();
      console.log('amount', amount);
      
      contractHandler.contract.methods.deposit().estimateGas({from: address, value: amount})
        .then(gas => {
          console.log('gas', gas);
          return contractHandler.contract.methods.deposit().send({from: address, gas, value: amount});
        })
      
      // let gas = await contractHandler.contract.methods.deposit().estimateGas({from: address, value: amount});
      // console.log('gas', gas);
      // let res = await contractHandler.contract.methods.deposit().send({from: address, gas, value: amount});
      created++;
    }
    catch (error){
      console.log('Create deposit error', error);
    }
  }
  return created;
}

async function startTest(options = {}) {
  statistic = {
    created: 0,
    notCreated: 0 
  }
  
  let accounts = await web3.eth.getAccounts();
  accounts = accounts.map(address => address.toLowerCase());
  console.log('accounts', accounts);
  
  for (let addr of accounts) {
    await web3.eth.personal.unlockAccount(addr, config.plasmaOperatorPassword, 0);
    console.log('unlockAccount', addr);
  }
  
  let txCount = options.count || 0;
  let transactions = [];
  let deporits = [];
  let depositBlock = 1;
  // console.log('startTest',)
  let startTime = Date.now();
  // console.log('startTime', startTime)

  // let currentAcc = accounts[1];
  // for (let index = 0; index < 1000; index++) {
  //   let uxtos = await getAllUtxos();
  //   let uxto1 = uxtos.find(u => u.address.toLowerCase() == accounts[1].address.toLowerCase());
  //   let uxto2 = uxtos.find(u => u.address.toLowerCase() == accounts[2].address.toLowerCase());
  // 
  //   if (uxto1 && uxto1.amount) {
  //     await createTx(uxto1, accounts[1], accounts[2].address);
  //   } else if (uxto2 && uxto2.amount) {
  //     await createTx(uxto2, accounts[2], accounts[1].address);
  //   }
  // }
  
  // for (let res of createNewTransactions(accounts, txCount)){
  //   console.log('------------------------------------')
  // }
  await createNewTransactions(accounts, txCount);
  
  let endTime = Date.now();
  // console.log('endTime', endTime)
  console.log('Time ms: ', endTime - startTime)
  
  console.log('statistic ', statistic);
}

async function createNewTransactions(addresses, txCount) {
  let accounts = {};
  addresses.forEach(address => accounts[address] = true);
  console.log('accounts', accounts);
  console.log('txCount', txCount);


    
  let count = 0;
  
  // for (let count = 0, length = depositEventsInBlock.length; i< length; i++){
  //   await depositEventHandler(depositEventsInBlock[i]);
  // }

  var nextAddressGen = getNextAddress(addresses);

  // console.log('nextAddressGen ', nextAddressGen);

  
  while (count <= txCount) {
    // console.log('iteration ---count-------------------------------- ', count);
    
    let accountUtxos = {};
    // let utxos = await getAllUtxos();
    let utxos = await txPool.getAllUxtos();

    // console.log('utxos ----------------------------------- ', utxos);
    
    // console.log('utxos ', utxos);
    if (txPool.poolLength > 0) {
      // console.log('txPool -poolLength---------------------------------- ', txPool.poolLength );
      await new Promise(resolve => setTimeout(resolve, 10));
      continue;
    }
    utxos = utxos.reduce((res, utxo) => {
      let addr = utxo.address.toLowerCase();
      if (accounts[addr]) {
        res.push(utxo);
      }
      return res;
    }, []);
    count += utxos.length;
    console.log('count ----------------------------------- ', count);

    // console.log('utxos1 ', utxos);
    // console.log('iteration ----count 1------------------------------- ', count);


    utxos.forEach((uxto, index) => {
      console.log('iteration ----createTx 1------------------------------- ', index);
      return createTx(uxto, uxto.address, nextAddressGen.next(uxto.address).value, count);
    })
    
    // await new Promise.race(utxos.map(uxto => {
    // 
    //   // console.log('utxos ', getNextAddress.next(uxto.address).value);
    //   // console.log('1111111111111111111 ',       uxto.address);
    //   // 
    //   // console.log('1111111111111111111 ',       nextAddressGen.next(uxto.address).value);
    //   // console.log('------------- ',);
    // 
    //   // return new Promise(async (resolve, reject) => {
    //   //   await createTx(uxto, uxto.address, nextAddressGen.next(uxto.address).value, count);
    //   //   resolve();
    //   // });
    //   return createTx(uxto, uxto.address, nextAddressGen.next(uxto.address).value, count);
    //   // let time = 100;
    //   // new Promise(function(resolve, reject) {
    //   //     setTimeout(resolve, time++);
    //   // });
    // }))
  }
  
}

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

function* createNewTransactions1(addresses, txCount = 0) {
  let accounts = {};
  addresses.forEach(address => accounts[address] = true);
  console.log('accounts', accounts);
  
  let currentAddress = 0;
  
  function getAddress() {
    if (addresses.length -1 <= ++currentAddress) {
      currentAddress = 0;
    }
    return addresses[currentAddress];
  }
  
  let count = 0;
  while (count++ <= txCount) {
    console.log('iter ', count);

    let accountUtxos = {};
    let utxos = yield getAllUtxos();
    console.log('utxos ', utxos);

    utxos = utxos.reduce((res, utxo) => {
      let addr = utxo.address.toLowerCase();
      if (addresses[addr]) {
        res.push(utxo);
      }
      return res;
    }, []);
    
    yield new Promise.race(utxos.map(uxto => {
      // return createTx(uxto, uxto.address, getAddress());
      let time = 100;
      new Promise(function(resolve, reject) {
          setTimeout(resolve, time++);
      });
    }))
  }
  
}




async function createTx(data, account, to, iter) {
  // let txData = [ data.blockNumber, data.txNumber, data.outputNumber, undefined, undefined, undefined, to, data.amount,undefined,undefined, undefined];
  // console.log('from ', account)
  // console.log('to   ', to)

  if (!account || !to ) {
    console.log('=====!=================================================================================!============ ')
  }
  
  let txDataForRlp = [ 
    ethUtil.toBuffer(new BN(data.blockNumber)),
    ethUtil.toBuffer(new BN(data.txNumber)),
    ethUtil.toBuffer(new BN(data.outputNumber)),
    undefined, undefined, undefined, to.toLowerCase(), new BN(data.amount),undefined,undefined, undefined];

    
  // let txRlpEncoded = tx.getHash(true).toString('hex');
  // 
  // const signature = await web3.eth.sign(ethUtil.addHexPrefix(txRlpEncoded), config.plasmaOperatorAddress);
    
  let txRlpEncoded = ethUtil.sha3(RLP.encode(txDataForRlp)).toString('hex');
  const signature = await web3.eth.sign(ethUtil.addHexPrefix(txRlpEncoded), account);
  // let txRlpEncoded = ethUtil.sha3(RLP.encode(txDataForRlp)).toString('hex');
  // const signature = ethUtil.ecsign(Buffer.from(txRlpEncoded, 'hex'), Buffer.from(account.pkey, 'hex'));
  // let signatureRaw = ethUtil.toRpcSig(signature.v, signature.r, signature.s);

  let signedTxData = {
    inputs: [{
      blockNumber: data.blockNumber,
      txNumber: data.txNumber,
      outputNumber: data.outputNumber
    }],
    outputs: [{
      address: to,
      amount: data.amount
    }],
    sign1: signature
  }
  let tx = await createSignedTransaction(signedTxData);

  // let address111 = tx.getAddressFromSignature(1);
  // address111 = ethUtil.addHexPrefix(address.toString('hex').toLowerCase());
  // console.log('address111', address111)
  // console.log('address111', address111)
  
  if (tx) {
    txPool.addTransaction(tx);

    console.log('createTx     ----------------------------------- ');

    statistic.created++;
    return true;
  }
  console.log('createSignedTransaction    not ----------------------------------- ');

  statistic.notCreated++;

  
  
  // console.log('add tx--------------------------', to, ' tx ', data.txNumber, ' out ', data.outputNumber);
}


async function getAllUtxos(address) {
  return await new Promise((resolve, reject) => {
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

          if (outputJson && address && address.toLowerCase() != outputJson.address.toLowerCase()) {
            return;
          }
          uxtos.push(outputJson);
        })
        .on('error', function (error) {
            console.log('error', error);
        })
        .on('end', function () {
          resolve(uxtos)
        })
    }
    catch(error){
      console.log('error', error);
    }
  })
}

module.exports = { startTest, createDeposits };