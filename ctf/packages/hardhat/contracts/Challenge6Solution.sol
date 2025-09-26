//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IChallenge6 {
    function mintFlag(uint256 code) external;
}

contract Challenge6Solution {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    function name() external pure returns (string memory) {
        return "BG CTF Challenge 6 Solution";
    }

    function solve(uint256 code) external {
        // Forward ~200k gas to satisfy Challenge6 (requires 190k < gasleft() < 200k inside target).
        // Using 200_000 here typically results in <200k by the time the check runs.
        (bool ok, bytes memory ret) = target.call{ gas: 200_000 }(
            abi.encodeWithSelector(IChallenge6.mintFlag.selector, code)
        );
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
