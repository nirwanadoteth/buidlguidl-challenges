//SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";

contract EthStreaming {
    // ============ Events ============
    event AddStream(address indexed recipient, uint256 cap);
    event Withdraw(address indexed recipient, uint256 amount);

    // ============ Errors ============
    error NotOwner();
    error NoStream();
    error InsufficientContractBalance();
    error AmountExceedsUnlocked();

    // ============ Storage ============
    uint256 public immutable unlockTime; // seconds to fully unlock a stream
    address public immutable owner; // contract owner

    struct Stream {
        uint256 cap; // maximum amount available when fully unlocked
        uint256 timeOfLastWithdrawal; // reference time used to compute unlocked amount
    }

    mapping(address => Stream) public streams;

    // Simple reentrancy guard
    bool private _entered;

    modifier nonReentrant() {
        require(!_entered, "REENTRANCY");
        _entered = true;
        _;
        _entered = false;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 _unlockTime) {
        unlockTime = _unlockTime;
        owner = msg.sender;
    }

    // Allow the contract to receive ETH
    receive() external payable {}

    /// @notice Add or update a stream for a recipient. Only owner.
    /// Stream is fully unlocked immediately after this call.
    function addStream(address recipient, uint256 cap) external onlyOwner {
        // Set the last withdrawal time so that stream is fully unlocked now
        streams[recipient] = Stream({
            cap: cap,
            timeOfLastWithdrawal: block.timestamp - unlockTime
        });
        emit AddStream(recipient, cap);
    }

    /// @notice Withdraw an amount of ETH according to the unlocked portion of the caller's stream
    function withdraw(uint256 amount) external nonReentrant {
        Stream memory s = streams[msg.sender];
        if (s.cap == 0) revert NoStream();

        // Ensure contract has enough balance
        if (amount > address(this).balance)
            revert InsufficientContractBalance();

        // Compute unlocked amount
        uint256 elapsed = block.timestamp - s.timeOfLastWithdrawal;
        uint256 unlocked = s.cap;
        if (elapsed < unlockTime) {
            // cap * elapsed / unlockTime
            unlocked = (s.cap * elapsed) / unlockTime;
        }

        if (amount > unlocked) revert AmountExceedsUnlocked();

        // Update the last withdrawal time to reflect what remains unlocked
        uint256 remainingUnlocked = unlocked - amount;
        uint256 newTimeOfLastWithdrawal;
        if (remainingUnlocked == 0) {
            newTimeOfLastWithdrawal = block.timestamp;
        } else {
            // Keep a portion of elapsed corresponding to the remaining unlocked funds
            // remainingElapsed = unlockTime * remainingUnlocked / cap
            uint256 remainingElapsed = (unlockTime * remainingUnlocked) / s.cap;
            newTimeOfLastWithdrawal = block.timestamp - remainingElapsed;
        }
        streams[msg.sender].timeOfLastWithdrawal = newTimeOfLastWithdrawal;

        // Effects done, perform interaction
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "TRANSFER_FAILED");

        emit Withdraw(msg.sender, amount);
    }
}
