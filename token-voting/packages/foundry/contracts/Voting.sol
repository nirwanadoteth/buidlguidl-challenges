// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Voting {
    // Token used for voting power
    IERC20 public immutable token;

    // Voting deadline as a unix timestamp
    uint256 public immutable votingDeadline;

    // Tally counters
    uint256 public votesFor;
    uint256 public votesAgainst;

    // Track whether an address has voted and its choice
    mapping(address => bool) public hasVoted;
    mapping(address => bool) private voteChoice; // true => for, false => against

    // Events
    event VoteCasted(address indexed voter, bool vote, uint256 weight);
    event VotesRemoved(address indexed voter, uint256 weight);

    constructor(address _tokenAddress, uint256 _votingPeriod) {
        require(_tokenAddress != address(0), "invalid token");
        token = IERC20(_tokenAddress);
        // Set deadline relative to now
        votingDeadline = block.timestamp + _votingPeriod;
    }

    // Cast a vote: true for, false against
    function vote(bool _support) external {
        require(block.timestamp <= votingDeadline, "voting ended");
        require(!hasVoted[msg.sender], "already voted");

        uint256 weight = token.balanceOf(msg.sender);
        require(weight > 0, "no tokens");

        if (_support) {
            votesFor += weight;
        } else {
            votesAgainst += weight;
        }

        hasVoted[msg.sender] = true;
        voteChoice[msg.sender] = _support;

        emit VoteCasted(msg.sender, _support, weight);
    }

    // Called by the token contract before a transfer to prevent double counting
    function removeVotes(address from) external {
        require(msg.sender == address(token), "only token");
        if (!hasVoted[from]) return; // nothing to do if they didn't vote

        uint256 weight = token.balanceOf(from);
        // Only adjust if there is weight to remove (balance before transfer)
        if (weight > 0) {
            if (voteChoice[from]) {
                // was for
                if (weight >= votesFor) {
                    // safety cap (should not happen under normal conditions)
                    votesFor = 0;
                } else {
                    votesFor -= weight;
                }
            } else {
                // was against
                if (weight >= votesAgainst) {
                    votesAgainst = 0;
                } else {
                    votesAgainst -= weight;
                }
            }

            emit VotesRemoved(from, weight);
        }

        // Reset vote so the address can vote again with new balance
        hasVoted[from] = false;
        delete voteChoice[from];
    }

    // Get the voting result after the deadline; true if approved by simple majority
    function getResult() external view returns (bool) {
        require(block.timestamp > votingDeadline, "too early");
        return votesFor > votesAgainst;
    }
}
