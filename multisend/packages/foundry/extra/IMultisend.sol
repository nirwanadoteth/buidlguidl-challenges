//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Interface for the Multisend contract (for reference only)
interface IMultisend {
    event SuccessfulETHTransfer(
        address _sender,
        address payable[] _receivers,
        uint256[] _amounts
    );
    event SuccessfulTokenTransfer(
        address _sender,
        address[] _receivers,
        uint256[] _amounts,
        address _token
    );

    function sendETH(
        address payable[] memory recipients,
        uint256[] memory amounts
    ) external payable;

    function sendTokens(
        address[] memory recipients,
        uint256[] memory amounts,
        address token
    ) external;
}
