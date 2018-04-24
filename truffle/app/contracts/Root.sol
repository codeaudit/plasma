pragma solidity ^0.4.21;

import "./SafeMath.sol";
import "./RLP.sol";
import "./HeapLib.sol";
import "./ArrayOp.sol";
import "./ByteUtils.sol";
import "./ECRecover.sol";

contract Root {
    using SafeMath for uint256;
    using HeapLib for HeapLib.Heap;
    using RLP for bytes;
    using RLP for RLP.RLPItem;
    using RLP for RLP.Iterator;
    using ArrayOp for uint256[];

    /*
     * Events
     */
    event Deposit(address depositor, uint amount, uint depositBlock);
    event Exit(address exitor, uint exitId);
    event ExitChallengedEvent(uint exitId);
    event ExitCompleteEvent(uint blockNumber, uint exitBlockNumber, uint exitTxIndex, uint exitOIndex);
    event Log(string log);
    event Log(bytes log);
    event Log(bytes32 log);
    event Log(bool log);
    event Log(uint log);
    event Log(address log);

    uint public currentBlock;
    uint public depositBlock;
    uint public lastParentBlock;

    uint constant week = 7 days;
    uint constant twoWeeks = 2 weeks;

    /*
     *  Modifiers
     */
    modifier isAuthority() {
        require(msg.sender == authority);
        _;
    }

    /* owner of the contract */
    address public authority;

    /*
     * Block struct
     */
    struct Block {
        bytes32 merkleRootHash;
        uint createdAt;
    }
    /*
     * Transaction struct
     */
    struct Transaction {
        uint32 txNumberInBlock;
        uint32 blockNumber1;
        uint32 txNumberInBlock1;
        uint8 outputNumberInTX1;
        uint32 blockNumber2;
        uint32 txNumberInBlock2;
        uint8 outputNumberInTX2;
        address newOwner1;
        uint denom1;
        address newOwner2;
        uint denom2;
        uint fee;
        address sender;
    }
    /*
     * Exit record
     */
    struct ExitRecord {
        uint blockNumber;
        uint txIndex;
        uint oIndex;
        address owner;
        uint amount;
        uint priority;
    }

    /*
     * Blockchain
     */
    mapping(uint => Block) public childChain;

    /*
     * Heap for exits
     */
    HeapLib.Heap exits;

    /*
     * Exit records
     */ 
    mapping(uint => uint[]) public exitIds;
    mapping(uint => ExitRecord) public exitRecords;


    function Root() public {
        authority = msg.sender;
        currentBlock = 1000;
        depositBlock = 1;
        lastParentBlock = block.number;
    }

    function submitBlock(bytes32 root) public isAuthority {
        childChain[currentBlock] = Block({
            merkleRootHash: root,
            createdAt: block.timestamp
        });
        currentBlock = currentBlock.add(1000);
        depositBlock = 1;
        lastParentBlock = block.number;
    }

    function deposit() public payable
    {
        require(depositBlock < 1000);
        bytes32 root = keccak256(msg.sender, msg.value);
        uint dblock = getCurrentDepositBlock();
        childChain[dblock] = Block({
            merkleRootHash: root,
            createdAt: block.timestamp
        });
        depositBlock = depositBlock.add(1);
        emit Deposit(msg.sender, msg.value, dblock);
    }

    function startExit(uint blockNumber, uint txIndex, uint oIndex, bytes txBytes, bytes proof, bytes confirmSig) public returns (uint exitId) {
        require(blockNumber > 0);

        var txList = txBytes.toRLPItem().toList();
        require(txList.length == 11);

        Block memory bl = childChain[blockNumber];
        require(checkSigs(keccak256(txBytes), bl.merkleRootHash, txList[0].toUint(), txList[3].toUint(), confirmSig));
        bytes32 merkleHash = keccak256(keccak256(txBytes), ByteUtils.slice(confirmSig, 0, 130));
        require(checkProof(merkleHash, bl.merkleRootHash, txBytes, proof));

        require(txList[6 + 2 * oIndex].toAddress() == msg.sender);

        uint priority = 0;
        uint weekBefore = block.timestamp - week;

        if (bl.createdAt > weekBefore) {
            priority = bl.createdAt;
        } else {
            priority = weekBefore;
        }
        
        exitId = blockNumber * 1000000000 + 10000 * txIndex + oIndex;
        ExitRecord storage record = exitRecords[exitId];
        require(record.blockNumber == 0);

        // Construct a new withdrawal.
        record.blockNumber = blockNumber;
        record.txIndex = txIndex;
        record.oIndex = oIndex;
        record.owner = msg.sender;
        record.amount = txList[7 + 2 * oIndex].toUint();
        record.priority = priority;

        exits.add(priority);
        exitIds[priority].push(exitId);

        emit Exit(msg.sender, exitId);
        return exitId;
    }

    function startDepositExit(uint256 depositPos, uint256 amount) public
    {
        uint256 blknum = depositPos / 1000000000;
        // Makes sure that deposit position is actually a deposit
        require(blknum % 1000 != 0);
        bytes32 root = childChain[blknum].merkleRootHash;
        bytes32 depositHash = keccak256(msg.sender, amount);
        require(root == depositHash);


        uint priority = 0;
        uint weekBefore = block.timestamp - week;

        if (childChain[blknum].createdAt > weekBefore) {
            priority = childChain[blknum].createdAt;
        } else {
            priority = weekBefore;
        }
        
        ExitRecord storage record = exitRecords[depositPos];
        require(record.blockNumber == 0);

        // Construct a new withdrawal.
        record.blockNumber = blknum;
        record.txIndex = 0;
        record.oIndex = 0;
        record.owner = msg.sender;
        record.amount = amount;
        record.priority = priority;

        exits.add(priority);
        exitIds[priority].push(depositPos);

        emit Exit(msg.sender, depositPos);
    }

    function challengeExit(
        uint exitId,
        uint blockNumber,
        uint txIndex,
        uint oIndex,
        bytes txBytes,
        bytes proof,
        bytes sigs,
        bytes confirmationSig
    ) public returns (bool success)
    {
        Block memory blk = childChain[blockNumber];

        var txList = txBytes.toRLPItem().toList();
        require(txList.length == 11);
        
        ExitRecord memory record = exitRecords[exitId];
        require(record.blockNumber > 0);

        bytes32 merkleHash = keccak256(keccak256(txBytes), sigs);
        require(checkProof(merkleHash, blk.merkleRootHash, txBytes, proof));
        
        bytes32 confirmationHash = keccak256(keccak256(txBytes), blk.merkleRootHash);

        require(record.owner == ECRecovery.recover(confirmationHash, confirmationSig) );

        // if the transaction spends the given withdrawal on plasma chain.
        if (isWithdrawalSpent(txBytes, record)) {
            exitIds[record.priority].remove(exitId);
            delete exitRecords[exitId];
            emit ExitChallengedEvent(exitId);
            return true;
        }
        
        return false;
    }

    function finalizeExits() public returns (bool success) {
        while (exits.data.length!=0 && now > exits.peek() + twoWeeks) {
            uint priority = exits.pop();
            for (uint i = 0; i < exitIds[priority].length; i++) {
                uint index = exitIds[priority][i];
                ExitRecord memory record = exitRecords[index];
                record.owner.transfer(record.amount);

                emit ExitCompleteEvent(currentBlock, record.blockNumber, record.txIndex, record.oIndex);
                delete exitRecords[index];
            }
            delete exitIds[priority];
        }
        return true;
    }

    function checkSigs(bytes32 txHash, bytes32 rootHash, uint256 blknum1, uint256 blknum2, bytes sigs) internal view returns (bool)
    {
        require(sigs.length % 65 == 0 && sigs.length <= 260);
        bytes memory sig1 = ByteUtils.slice(sigs, 0, 65);
        bytes memory sig2 = ByteUtils.slice(sigs, 65, 65);
        bytes memory confSig1 = ByteUtils.slice(sigs, 130, 65);
        bytes32 confirmationHash = keccak256(txHash, rootHash);

        bool check1 = true;
        bool check2 = true;

        check1 = ECRecovery.recover(txHash, sig1) == ECRecovery.recover(confirmationHash, confSig1);
        if (blknum2 > 0) {
            bytes memory confSig2 = ByteUtils.slice(sigs, 195, 65);
            check2 = ECRecovery.recover(txHash, sig2) == ECRecovery.recover(confirmationHash, confSig2);
        }
        return check1 && check2;
    }

    function checkProof(bytes32 merkle, bytes32 root, bytes target, bytes proof) pure internal returns (bool valid)
    {
        bytes32 hash = merkle;
        for (uint i = 32; i < proof.length; i += 33) {
            bytes1 flag;
            bytes32 sibling;
            assembly {
                flag := mload(add(proof, i))
                sibling := mload(add(add(proof, i), 1))
            }
            if (flag == 0) {
                hash = keccak256(sibling, hash);
            } else if (flag == 1) {
                hash = keccak256(hash, sibling);
            }
        }
        return hash == root;
    }

    function getChain(uint blockNumber) public view returns (bytes32, uint)
    {
        return (childChain[blockNumber].merkleRootHash, childChain[blockNumber].createdAt);
    }

    function getBalance(address addr) public view returns(uint) {
        return addr.balance;
    }

    function isWithdrawalSpent(bytes txBytes, ExitRecord record) view internal returns (bool spent)
    {
        var txList = txBytes.toRLPItem().toList();
        require(txList.length == 11);
        uint blockNumber;
        uint txIndex;
        uint oIndex;

        if (!txList[0].isEmpty()) {
            blockNumber = txList[0].toUint();
            txIndex = txList[1].isEmpty() ? 0 : txList[1].toUint();
            oIndex = txList[2].isEmpty() ? 0 : txList[2].toUint();
            if (record.blockNumber == blockNumber && record.txIndex == txIndex && record.oIndex == oIndex) {
                return true;
            }
        }
        if (!txList[3].isEmpty()) {
            blockNumber = txList[3].toUint();
            txIndex = txList[4].isEmpty() ? 0 : txList[4].toUint();
            oIndex = txList[5].isEmpty() ? 0 : txList[5].toUint();
            if (record.blockNumber == blockNumber && record.txIndex == txIndex && record.oIndex == oIndex) {
                return true;
            }
        }
        
        return false;
    }

    function getCurrentBlock() public view returns(uint) {
        return currentBlock;
    }

    function getDepositBlock() public view returns(uint) {
        return depositBlock;
    }

    function getCurrentDepositBlock() public view returns(uint) {
        return currentBlock.sub(1000).add(depositBlock);
    }

    function getExit(uint exitId) public view returns (address, uint, uint)
    {
        ExitRecord memory er = exitRecords[exitId];
        return ( er.owner, er.amount, er.priority );
    }


}