// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console2} from "../lib/forge-std/src/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RebasingERC20 is IERC20 {
    string public constant name = "Rebasing Token";
    string public constant symbol = "$RBT";
    uint8 public constant decimals = 18;

    address public owner;
    uint256 private _totalSupply;
    uint256 private _initialSupply;
    uint256 private _scalingFactor = 1e18;

    mapping(address => uint256) private _gonBalances;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Rebase(uint256 totalSupply);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        _initialSupply = initialSupply;
        _totalSupply = initialSupply;
        _gonBalances[msg.sender] = (initialSupply * _scalingFactor) / 1e18;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        // Adjusted balance using scaling factor
        return
            (_gonBalances[account] * _totalSupply) /
            ((_initialSupply * _scalingFactor) / 1e18);
    }

    function transfer(
        address to,
        uint256 amount
    ) public override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(
        address owner_,
        address spender
    ) public view override returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(
        address spender,
        uint256 amount
    ) public override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        require(allowed >= amount, "ERC20: transfer amount exceeds allowance");
        _transfer(from, to, amount);
        _approve(from, msg.sender, allowed - amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from zero address");
        require(to != address(0), "ERC20: transfer to zero address");
        // Convert amount to gons
        uint256 gonAmount = (amount * _initialSupply * _scalingFactor) /
            (_totalSupply * 1e18);
        require(
            _gonBalances[from] >= gonAmount,
            "ERC20: transfer amount exceeds balance"
        );
        _gonBalances[from] -= gonAmount;
        _gonBalances[to] += gonAmount;
        emit Transfer(from, to, amount);
    }

    function _approve(
        address owner_,
        address spender,
        uint256 amount
    ) internal {
        require(owner_ != address(0), "ERC20: approve from zero address");
        require(spender != address(0), "ERC20: approve to zero address");
        _allowances[owner_][spender] = amount;
        emit Approval(owner_, spender, amount);
    }

    function rebase(int256 supplyDelta) external onlyOwner {
        require(supplyDelta != 0, "RebasingERC20: supplyDelta is zero");
        uint256 oldSupply = _totalSupply;
        if (supplyDelta < 0) {
            require(
                _totalSupply > uint256(-supplyDelta),
                "RebasingERC20: supplyDelta too negative"
            );
            _totalSupply -= uint256(-supplyDelta);
        } else {
            _totalSupply += uint256(supplyDelta);
        }
        emit Rebase(_totalSupply);
    }

    // Optional: transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
