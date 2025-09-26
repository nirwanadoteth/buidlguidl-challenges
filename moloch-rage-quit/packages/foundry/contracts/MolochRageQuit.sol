//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";

// Good luck!

contract MolochRageQuit {
    // Events (names don't need to match tests, but order/types do)
    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address contractAddr,
        bytes data,
        uint256 deadline
    );
    event MemberAdded(address newMember);
    event Voted(uint256 proposalId, address member);
    event ProposalExecuted(uint256 proposalId);
    event RageQuit(address member, uint256 returnedETH);

    struct Proposal {
        address proposer;
        address contractAddr;
        bytes data;
        uint256 votes;
        uint256 deadline;
        bool executed;
    }

    // Membership and shares
    mapping(address => uint256) private _shares; // shares > 0 => member
    uint256 public totalShares;

    // Proposals
    uint256 public proposalCount;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _hasVoted; // proposalId => voter => hasVoted

    constructor(uint256 initialShares) {
        require(initialShares > 0, "initialShares=0");
        _shares[msg.sender] = initialShares;
        totalShares = initialShares;
    }

    // Create a proposal (only members)
    function propose(
        address contractToCall,
        bytes memory data,
        uint256 deadline
    ) external {
        require(isMember(msg.sender), "not member");
        require(contractToCall != address(0), "addr=0");
        require(deadline > block.timestamp, "bad deadline");

        proposalCount += 1;
        uint256 proposalId = proposalCount;
        _proposals[proposalId] = Proposal({
            proposer: msg.sender,
            contractAddr: contractToCall,
            data: data,
            votes: 0,
            deadline: deadline,
            executed: false
        });

        emit ProposalCreated(
            proposalId,
            msg.sender,
            contractToCall,
            data,
            deadline
        );
    }

    // Can only be called by this contract (via successful proposal execution)
    function addMember(address newMember, uint256 shares) external {
        require(msg.sender == address(this), "only self");
        require(newMember != address(0), "member=0");
        require(shares > 0, "shares=0");
        require(_shares[newMember] == 0, "already member");

        _shares[newMember] = shares;
        totalShares += shares;
        emit MemberAdded(newMember);
    }

    // Vote for a proposal with your shares (only once)
    function vote(uint256 proposalId) external {
        require(isMember(msg.sender), "not member");
        Proposal storage p = _proposals[proposalId];
        require(p.contractAddr != address(0), "no proposal");
        require(!_hasVoted[proposalId][msg.sender], "already voted");
        require(block.timestamp <= p.deadline, "past deadline");

        _hasVoted[proposalId][msg.sender] = true;
        uint256 voterShares = _shares[msg.sender];
        p.votes += voterShares;

        emit Voted(proposalId, msg.sender);
    }

    // Execute proposal if deadline passed and majority by shares approved
    function executeProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        require(p.contractAddr != address(0), "no proposal");
        require(!p.executed, "executed");
        require(block.timestamp > p.deadline, "deadline not reached");
        require(totalShares > 0, "no shares");
        require(p.votes * 2 > totalShares, "not approved"); // strict majority

        p.executed = true;

        (bool ok, bytes memory ret) = p.contractAddr.call(p.data);
        require(ok, _revertMsg(ret));

        emit ProposalExecuted(proposalId);
    }

    // Allow a member to exit and receive their proportional share of ETH treasury
    function rageQuit() external {
        uint256 memberShares = _shares[msg.sender];
        require(memberShares > 0, "not member");

        // Effects
        _shares[msg.sender] = 0;
        uint256 currentTotal = totalShares;
        totalShares = currentTotal - memberShares;

        // Payout calculation based on balance before transfer
        uint256 payout = (address(this).balance * memberShares) / currentTotal;

        // Interaction
        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "send failed");

        emit RageQuit(msg.sender, payout);
    }

    // Views
    function getProposal(
        uint256 proposalId
    )
        external
        view
        returns (
            address proposer,
            address contractAddr,
            bytes memory data,
            uint256 votes,
            uint256 deadline
        )
    {
        Proposal storage p = _proposals[proposalId];
        require(p.contractAddr != address(0), "no proposal");
        return (p.proposer, p.contractAddr, p.data, p.votes, p.deadline);
    }

    function isMember(address member) public view returns (bool) {
        return _shares[member] > 0;
    }

    // Helper to bubble up revert reasons from external calls
    function _revertMsg(bytes memory ret) private pure returns (string memory) {
        if (ret.length < 68) return "call failed";
        assembly {
            ret := add(ret, 0x04)
        }
        return abi.decode(ret, (string));
    }

    receive() external payable {}
}
