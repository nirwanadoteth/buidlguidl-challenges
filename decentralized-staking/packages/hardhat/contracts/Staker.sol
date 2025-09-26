// SPDX-License-Identifier: MIT
pragma solidity 0.8.20; //Do not change the solidity version as it negatively impacts submission grading

import "hardhat/console.sol";
import "./ExampleExternalContract.sol";

contract Staker {
    ExampleExternalContract public exampleExternalContract;

    // Track individual balances
    mapping(address => uint256) public balances;

    // Threshold to trigger completion
    uint256 public constant threshold = 1 ether;

    // Deadline after which execute/withdraw are allowed
    uint256 public immutable deadline;

    // Flag to open withdrawals if threshold not met by deadline
    bool public openForWithdraw;

    // Event emitted for each stake (used by the frontend All Stakings tab)
    event Stake(address indexed sender, uint256 amount);

    constructor(address exampleExternalContractAddress) {
        exampleExternalContract = ExampleExternalContract(exampleExternalContractAddress);
        // Set deadline to 2 minutes for local testing (72 hours for challenge)
        deadline = block.timestamp + 72 hours; // Adjust this for the challenge UI
        openForWithdraw = false;
    }

    // Ensure the external contract hasn't been completed yet
    modifier notCompleted() {
        require(!exampleExternalContract.completed(), "Already completed");
        _;
    }

    // Collect funds in a payable `stake()` function and track individual `balances` with a mapping:
    // (Make sure to add a `Stake(address,uint256)` event and emit it for the frontend `All Stakings` tab to display)

    function stake() public payable {
        require(timeLeft() > 0, "Staking period over");
        require(msg.value > 0, "No ETH sent");
        balances[msg.sender] += msg.value;
        emit Stake(msg.sender, msg.value);
    }

    // After some `deadline` allow anyone to call an `execute()` function
    // If the deadline has passed and the threshold is met, it should call `exampleExternalContract.complete{value: address(this).balance}()`
    function execute() external notCompleted {
        require(timeLeft() == 0, "Deadline not reached");

        // If enough ETH is staked, send it to the external contract and mark complete
        if (address(this).balance >= threshold) {
            exampleExternalContract.complete{ value: address(this).balance }();
        } else {
            // Otherwise, open withdrawals for stakers
            openForWithdraw = true;
        }
    }

    // If the `threshold` was not met, allow everyone to call a `withdraw()` function to withdraw their balance
    function withdraw() external notCompleted {
        require(timeLeft() == 0, "Deadline not reached");
        require(openForWithdraw, "Withdrawals not open");

        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");

        // Effects
        balances[msg.sender] = 0;

        // Interaction
        (bool sent, ) = payable(msg.sender).call{ value: amount }("");
        require(sent, "Withdraw failed");
    }

    // Add a `timeLeft()` view function that returns the time left before the deadline for the frontend
    function timeLeft() public view returns (uint256) {
        if (block.timestamp >= deadline) {
            return 0;
        }
        return deadline - block.timestamp;
    }

    // Add the `receive()` special function that receives eth and calls stake()
    receive() external payable {
        stake();
    }
}
