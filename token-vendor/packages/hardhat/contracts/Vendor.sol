pragma solidity 0.8.20; //Do not change the solidity version as it negatively impacts submission grading
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol";
import "./YourToken.sol";

contract Vendor is Ownable {
    event BuyTokens(address indexed buyer, uint256 amountOfETH, uint256 amountOfTokens);
    event SellTokens(address indexed seller, uint256 amountOfTokens, uint256 amountOfETH);

    uint256 public constant tokensPerEth = 100; // 100 tokens per 1 ETH

    YourToken public yourToken;

    constructor(address tokenAddress) Ownable(msg.sender) {
        yourToken = YourToken(tokenAddress);
    }

    // payable buyTokens() function
    function buyTokens() external payable {
        require(msg.value > 0, "Send ETH to buy tokens");
        // Calculate amount of tokens in token's smallest units
        uint256 amountToBuy = msg.value * tokensPerEth;
        require(amountToBuy > 0, "Insufficient ETH for 1 token");

        // Check Vendor token balance
        uint256 vendorBalance = yourToken.balanceOf(address(this));
        require(vendorBalance >= amountToBuy, "ERC20InsufficientBalance");

        bool success = yourToken.transfer(msg.sender, amountToBuy);
        require(success, "Token transfer failed");

        emit BuyTokens(msg.sender, msg.value, amountToBuy);
    }

    // withdraw ETH to owner
    function withdraw() external onlyOwner {
        uint256 amount = address(this).balance;
        (bool sent, ) = owner().call{ value: amount }("");
        require(sent, "Withdraw failed");
    }

    // sell tokens back to the vendor
    function sellTokens(uint256 _amount) external {
        require(_amount > 0, "Amount must be > 0");
        // Calculate ETH to send back (in wei)
        uint256 ethToReturn = _amount / tokensPerEth;
        require(address(this).balance >= ethToReturn, "Not enough ETH in Vendor");

        // Pull tokens from seller (requires prior approval)
        bool success = yourToken.transferFrom(msg.sender, address(this), _amount);
        require(success, "Token transferFrom failed");

        // Send ETH
        (bool sent, ) = msg.sender.call{ value: ethToReturn }("");
        require(sent, "ETH transfer failed");

        emit SellTokens(msg.sender, _amount, ethToReturn);
    }
}
