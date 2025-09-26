//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";

/// @title Social Recovery Wallet
/// @notice Minimal smart contract wallet with guardian-based recovery.
contract SocialRecoveryWallet {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    address public owner;
    mapping(address => bool) public isGuardian;
    uint256 public guardianCount;

    // Recovery voting (single active proposal via cycle id)
    address public currentProposedOwner;
    uint256 public currentVotes;
    uint256 private currentCycle; // increments to invalidate previous votes without clearing
    mapping(address => uint256) private lastVotedCycle; // guardian => cycle they last voted in

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event NewOwnerSignaled(address indexed by, address indexed proposedOwner);
    event RecoveryExecuted(address indexed newOwner);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------
    constructor(address[] memory _guardians) {
        owner = msg.sender;

        // initialize guardians
        uint256 len = _guardians.length;
        for (uint256 i = 0; i < len; i++) {
            address g = _guardians[i];
            require(g != address(0), "guardian=0");
            require(!isGuardian[g], "dup guardian");
            isGuardian[g] = true;
            guardianCount++;
        }
    }

    // ---------------------------------------------------------------------
    // Wallet functionality
    // ---------------------------------------------------------------------
    /// @notice Execute an arbitrary call from the wallet. Only owner can call.
    /// @param callee Target address to call.
    /// @param value ETH value to forward with the call.
    /// @param data Calldata to send to the target.
    function call(
        address callee,
        uint256 value,
        bytes calldata data
    ) external payable {
        require(msg.sender == owner, "not owner");
        (bool success, bytes memory returndata) = callee.call{value: value}(
            data
        );
        if (!success) {
            // bubble up revert reason if present
            if (returndata.length > 0) {
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(returndata, 32), returndata_size)
                }
            }
            revert("call failed");
        }
    }

    // ---------------------------------------------------------------------
    // Recovery
    // ---------------------------------------------------------------------
    /// @notice Guardian signals support for a new owner. When all guardians signal, owner is changed.
    function signalNewOwner(address _proposedOwner) external {
        require(isGuardian[msg.sender], "not guardian");
        require(_proposedOwner != address(0), "proposed=0");

        // If proposal changes, reset votes by incrementing cycle
        if (_proposedOwner != currentProposedOwner) {
            currentProposedOwner = _proposedOwner;
            currentVotes = 0;
            unchecked {
                currentCycle++;
            }
        }

        // Ensure guardian hasn't voted in the current cycle
        require(lastVotedCycle[msg.sender] < currentCycle, "already voted");
        lastVotedCycle[msg.sender] = currentCycle;
        currentVotes += 1;

        emit NewOwnerSignaled(msg.sender, _proposedOwner);

        if (currentVotes == guardianCount && guardianCount > 0) {
            owner = _proposedOwner;
            emit RecoveryExecuted(_proposedOwner);
            // reset state for next recovery round
            currentProposedOwner = address(0);
            currentVotes = 0;
            unchecked {
                currentCycle++;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Guardian management (owner-only)
    // ---------------------------------------------------------------------
    function addGuardian(address _guardian) external {
        require(msg.sender == owner, "not owner");
        require(_guardian != address(0), "guardian=0");
        require(!isGuardian[_guardian], "exists");
        isGuardian[_guardian] = true;
        guardianCount += 1;
        // Changing guardian set invalidates any ongoing recovery
        _resetRecoveryState();
    }

    function removeGuardian(address _guardian) external {
        require(msg.sender == owner, "not owner");
        require(isGuardian[_guardian], "not guardian");
        isGuardian[_guardian] = false;
        guardianCount -= 1;
        // Changing guardian set invalidates any ongoing recovery
        _resetRecoveryState();
    }

    function _resetRecoveryState() internal {
        if (currentProposedOwner != address(0) || currentVotes != 0) {
            currentProposedOwner = address(0);
            currentVotes = 0;
            unchecked {
                currentCycle++;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Receive/fallback to accept ETH
    // ---------------------------------------------------------------------
    receive() external payable {}

    fallback() external payable {}
}
