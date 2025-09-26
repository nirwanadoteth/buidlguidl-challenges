//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IChallenge11 {
    function mintFlag() external;
}

contract Challenge11Caller {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    function callMint() external {
        IChallenge11(target).mintFlag();
    }
}

contract Challenge11Factory {
    event Deployed(address addr);

    function deployWithSalt(bytes32 salt, bytes memory creation) external returns (address a) {
        assembly {
            a := create2(0, add(creation, 0x20), mload(creation), salt)
        }
        require(a != address(0), "create2 failed");
        emit Deployed(a);
    }
}
