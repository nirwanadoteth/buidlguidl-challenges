// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";

// Dead Man's Switch implementation per challenge requirements
contract DeadMansSwitch {
    // State
    mapping(address => uint256) public balances;
    mapping(address => uint256) public lastCheckIn; // public getter used by tests
    mapping(address => uint256) public checkInIntervalsStorage; // internal storage; expose via function
    mapping(address => address[]) private _beneficiaries;

    // Reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    // Events
    event CheckIn(address account, uint256 timestamp);
    event BeneficiaryAdded(address user, address beneficiary);
    event BeneficiaryRemoved(address user, address beneficiary);
    event Deposit(address depositor, uint256 amount);
    event Withdrawal(address beneficiary, uint256 amount);

    // Internal utils
    modifier nonReentrant() {
        require(_status != _ENTERED, "reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    function _checkIn(address account) internal {
        lastCheckIn[account] = block.timestamp;
        emit CheckIn(account, block.timestamp);
    }

    function _isBeneficiary(
        address account,
        address who
    ) internal view returns (bool) {
        address[] storage list = _beneficiaries[account];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == who) return true;
        }
        return false;
    }

    // Write functions
    function setCheckInInterval(uint256 interval) external {
        require(interval != 0, "interval=0");
        checkInIntervalsStorage[msg.sender] = interval;
        _checkIn(msg.sender);
    }

    function checkIn() external {
        _checkIn(msg.sender);
    }

    function addBeneficiary(address beneficiary) external {
        require(beneficiary != address(0), "zero addr");
        require(!_isBeneficiary(msg.sender, beneficiary), "exists");
        _beneficiaries[msg.sender].push(beneficiary);
        emit BeneficiaryAdded(msg.sender, beneficiary);
        _checkIn(msg.sender);
    }

    function removeBeneficiary(address beneficiary) external {
        address[] storage list = _beneficiaries[msg.sender];
        uint256 len = list.length;
        uint256 idx = len; // sentinel for not found
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == beneficiary) {
                idx = i;
                break;
            }
        }
        require(idx != len, "not found");
        // swap & pop
        if (idx != len - 1) {
            list[idx] = list[len - 1];
        }
        list.pop();
        emit BeneficiaryRemoved(msg.sender, beneficiary);
        _checkIn(msg.sender);
    }

    function deposit() public payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
        _checkIn(msg.sender);
    }

    function withdraw(address account, uint256 amount) external nonReentrant {
        // Authorization: self or beneficiary after interval
        if (msg.sender != account) {
            uint256 interval = checkInIntervalsStorage[account];
            require(_isBeneficiary(account, msg.sender), "not beneficiary");
            require(interval != 0, "no interval");
            require(
                block.timestamp > lastCheckIn[account] + interval,
                "too soon"
            );
        }

        require(balances[account] >= amount, "insufficient");

        // Effects first
        balances[account] -= amount;

        // Interactions
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "xfer fail");

        emit Withdrawal(msg.sender, amount);
        _checkIn(msg.sender);
    }

    // Views
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function checkInInterval(address account) external view returns (uint256) {
        return checkInIntervalsStorage[account];
    }

    // Receive/fallback: treat as deposit from sender
    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }
}
