'use strict';

const Web3 = require("web3");
const createKeccakHash = require('keccak');


const addHexPrefix = (msg) => {
    return '0x' + msg;
};

const removeHexPrefix = (msg) => {
    if (Web3.utils.isHexStrict(msg)) {
        return msg.slice(2);
    } else {
        return msg;
    }
};

const keccakHash = (value) => {
    return createKeccakHash('keccak256').update(value).digest('hex');
}

const signTransaction = async (message, address) => {
    return await web3.eth.sign(message, address);
};

const isValidSignature = async (message, signature, address) => {
    const hash = await web3.eth.accounts.hashMessage(message);
    const signer = await web3.eth.accounts.recover(hash, signature);
    return removeHexPrefix(address.toLowerCase()) == utils.removeHexPrefix(signer.toLowerCase());
};

const bufferToHex = (buf, withPrefix) => {
    if (withPrefix) {
        return addHexPrefix(buf.toString('hex'));
    } else {
        return buf.toString('hex');
    }
};

const weiToEther = (data) => {
    return data / 1000000000000000000;
};

const etherToWei = (data) => {
    return data * 1000000000000000000;
};

module.exports = {};