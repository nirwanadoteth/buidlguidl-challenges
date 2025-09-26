// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Governance {
    // Events
    event ProposalCreated(
        uint proposalId,
        string title,
        uint votingDeadline,
        address creator
    );
    event VoteCasted(
        uint proposalId,
        address voter,
        uint8 vote,
        uint256 weight
    );
    event VotesRemoved(address voter, uint8 vote, uint256 weight);

    // Vote types
    uint8 private constant VOTE_AGAINST = 0;
    uint8 private constant VOTE_FOR = 1;
    uint8 private constant VOTE_ABSTAIN = 2;

    struct VoterInfo {
        bool voted;
        uint8 choice; // 0=Against,1=For,2=Abstain
        uint256 weight; // weight counted at vote time
    }

    struct Proposal {
        uint256 id;
        string title;
        uint256 deadline;
        address creator;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        mapping(address => VoterInfo) voters;
        bool exists;
    }

    // Token and config
    address public immutable token;
    IERC20 private immutable drt;
    uint256 public immutable votingPeriod;

    // Proposals
    uint256 private _nextProposalId = 1;
    mapping(uint256 => Proposal) private _proposals;
    uint256 public activeProposalId; // 0 means none
    uint256 public queuedProposalId; // 0 means none

    constructor(address _tokenAddress, uint256 _votingPeriod) {
        require(_tokenAddress != address(0), "token required");
        require(_votingPeriod > 0, "period required");
        token = _tokenAddress;
        drt = IERC20(_tokenAddress);
        votingPeriod = _votingPeriod;
    }

    // Internal: promote queued to active if active expired
    function _syncActive() internal {
        if (activeProposalId != 0) {
            Proposal storage active = _proposals[activeProposalId];
            if (block.timestamp > active.deadline) {
                // Active has ended, promote queued if present
                if (queuedProposalId != 0) {
                    activeProposalId = queuedProposalId;
                    queuedProposalId = 0;
                } else {
                    activeProposalId = 0;
                }
            }
        } else if (activeProposalId == 0 && queuedProposalId != 0) {
            // No active but a queued exists (edge), make it active
            activeProposalId = queuedProposalId;
            queuedProposalId = 0;
        }
    }

    // Create a new proposal. If an active proposal exists, queue this one (only one queued allowed).
    function propose(string memory title) public returns (uint256) {
        // Only token holders can propose
        require(drt.balanceOf(msg.sender) > 0, "not a member");

        _syncActive();

        uint256 pId = _nextProposalId++;
        Proposal storage p = _proposals[pId];
        p.id = pId;
        p.title = title;
        p.creator = msg.sender;
        p.exists = true;

        if (activeProposalId == 0) {
            // Make active
            p.deadline = block.timestamp + votingPeriod;
            activeProposalId = pId;
        } else {
            // Queue if no queued yet
            require(queuedProposalId == 0, "queue full");
            // Ensure no overlap: set its deadline to start after active ends
            p.deadline = _proposals[activeProposalId].deadline + votingPeriod;
            queuedProposalId = pId;
        }

        emit ProposalCreated(pId, title, p.deadline, msg.sender);
        return pId;
    }

    // Return proposal details
    function getProposal(
        uint256 id
    )
        public
        view
        returns (string memory title, uint256 deadline, address creator)
    {
        Proposal storage p = _proposals[id];
        require(p.exists, "no proposal");
        return (p.title, p.deadline, p.creator);
    }

    // Vote on the active proposal
    function vote(uint8 voteType) public {
        require(voteType <= VOTE_ABSTAIN, "invalid vote");
        require(drt.balanceOf(msg.sender) > 0, "not a member");

        _syncActive();
        uint256 pId = activeProposalId;
        require(pId != 0, "no active proposal");
        Proposal storage p = _proposals[pId];
        require(block.timestamp <= p.deadline, "voting ended");

        VoterInfo storage v = p.voters[msg.sender];
        require(!v.voted, "already voted");

        uint256 weight = drt.balanceOf(msg.sender);
        require(weight > 0, "no weight");

        if (voteType == VOTE_FOR) {
            p.votesFor += weight;
        } else if (voteType == VOTE_AGAINST) {
            p.votesAgainst += weight;
        } else {
            p.votesAbstain += weight;
        }

        v.voted = true;
        v.choice = voteType;
        v.weight = weight;

        emit VoteCasted(pId, msg.sender, voteType, weight);
    }

    // Called by the token before balances move to remove counted votes for the sender on the active proposal
    function removeVotes(address from) external {
        require(msg.sender == token, "only token");

        _syncActive();
        uint256 pId = activeProposalId;
        if (pId == 0) return; // nothing to do

        Proposal storage p = _proposals[pId];
        VoterInfo storage v = p.voters[from];
        if (!v.voted) return; // nothing to remove

        uint256 currentBalance = drt.balanceOf(from);
        uint256 amount = v.weight;
        if (currentBalance < amount) amount = currentBalance; // safety
        if (amount == 0) {
            // Clear vote record even if zero amount
            uint8 choiceZero = v.choice;
            v.voted = false;
            v.weight = 0;
            emit VotesRemoved(from, choiceZero, 0);
            return;
        }

        if (v.choice == VOTE_FOR) {
            // Safe-guard against underflow using min above
            p.votesFor -= amount;
        } else if (v.choice == VOTE_AGAINST) {
            p.votesAgainst -= amount;
        } else {
            p.votesAbstain -= amount;
        }

        uint8 choice = v.choice;
        v.voted = false;
        v.weight = 0;
        emit VotesRemoved(from, choice, amount);
    }

    // Get result: true if votesFor > votesAgainst. Revert if still in progress
    function getResult(uint256 id) public view returns (bool) {
        Proposal storage p = _proposals[id];
        require(p.exists, "no proposal");
        require(block.timestamp > p.deadline, "in progress");
        return p.votesFor > p.votesAgainst;
    }
}
