//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Multisend
/// @notice Sends ETH or ERC20 tokens to multiple recipients in a single transaction
contract Multisend {
    // Events
    event SuccessfulETHTransfer(
        address indexed _sender,
        address payable[] _receivers,
        uint256[] _amounts
    );
    event SuccessfulTokenTransfer(
        address indexed _sender,
        address[] _receivers,
        uint256[] _amounts,
        address indexed _token
    );

    /// @notice Send ETH to multiple recipients
    /// @param recipients The list of payable recipient addresses
    /// @param amounts The list of ETH amounts to send to each recipient
    function sendETH(
        address payable[] memory recipients,
        uint256[] memory amounts
    ) external payable {
        require(recipients.length == amounts.length, "LEN_MISMATCH");

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        require(msg.value == total, "INVALID_MSG_VALUE");

        for (uint256 i = 0; i < recipients.length; i++) {
            (bool success, ) = recipients[i].call{value: amounts[i]}("");
            require(success, "ETH_TRANSFER_FAILED");
        }

        emit SuccessfulETHTransfer(msg.sender, recipients, amounts);
    }

    /// @notice Send ERC20 tokens to multiple recipients
    /// @param recipients The list of recipient addresses
    /// @param amounts The list of token amounts to send to each recipient
    /// @param token The address of the ERC20 token to send
    function sendTokens(
        address[] memory recipients,
        uint256[] memory amounts,
        address token
    ) external {
        require(recipients.length == amounts.length, "LEN_MISMATCH");

        IERC20 erc20 = IERC20(token);
        for (uint256 i = 0; i < recipients.length; i++) {
            bool ok = erc20.transferFrom(msg.sender, recipients[i], amounts[i]);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit SuccessfulTokenTransfer(msg.sender, recipients, amounts, token);
    }
}
