//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WrappedETH
/// @notice Minimal WETH implementation backed 1:1 by native ETH.
contract WrappedETH is ERC20, ReentrancyGuard {
    /// @notice Emitted when `user` deposits `amount` of ETH and receives WETH.
    event Deposit(address indexed user, uint256 amount);
    /// @notice Emitted when `user` withdraws `amount` of WETH and receives ETH.
    event Withdrawal(address indexed user, uint256 amount);

    constructor() ERC20("WrappedEth", "WETH") {}

    /// @notice Deposit native ETH and receive the same amount of WETH.
    function deposit() public payable {
        require(msg.value > 0, "NO_VALUE");
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw native ETH by burning WETH tokens.
    /// @param amount The amount of WETH to unwrap for ETH.
    function withdraw(uint256 amount) external nonReentrant {
        require(balanceOf(msg.sender) >= amount, "INSUFFICIENT_BALANCE");

        // Effects: burn first to prevent reentrancy draining via recursive calls.
        _burn(msg.sender, amount);

        // Interaction: send ETH to caller.
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH_TRANSFER_FAILED");
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Accept plain ETH transfers and treat them as deposits.
    receive() external payable {
        deposit();
    }

    /// @notice Fallback also treats any ETH sent as deposit.
    fallback() external payable {
        deposit();
    }
}
