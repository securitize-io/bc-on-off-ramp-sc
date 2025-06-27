/**
 * Copyright 2024 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
pragma solidity ^0.8.22;

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityProvider} from "../provider/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "../nav/ISecuritizeNavProvider.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";

contract ExternalRedemptionMock is ISecuritizeOffRamp {
    IDSToken public asset;
    address public assetAddress;
    ILiquidityProvider public liquidityProvider;
    ISecuritizeNavProvider public navProvider;
    address public feeManager;
    bool public assetBurn;
    IERC20 private liquidityToken;

    // Custom errors to match the main contract
    error InsufficientOutputAmount(uint256 actual, uint256 minimum);

    // Events needed for compatibility with tests
    event RedemptionCompleted(address indexed redeemer, uint256 assetAmount, uint256 liquidityAmount, uint256 rate);

    constructor(address _mockAsset, address _liquidityToken, address _navProvider) {
        assetAddress = _liquidityToken; // This is the key change - in ExternalRedemptionMock, we need to make assetAddress match liquidityToken for test compatibility
        asset = IDSToken(_mockAsset);
        liquidityToken = IERC20(_liquidityToken);
        navProvider = ISecuritizeNavProvider(_navProvider);
        feeManager = address(0);
        assetBurn = false;
    }

    function initialize(address _asset, address _navProvider, address _feeManager, bool _assetBurn) external override {
        // Not needed for mock, but required by interface
    }

    /*
     *  1:1 redeem mock with slippage protection
     */
    function redeem(uint256 amount, uint256 _minOutputAmount) external override {
        // Calculate output amount (in a real scenario this would be based on NAV rate)
        uint256 outputAmount = amount; // Simple 1:1 for testing

        // Check minimum output amount requirement
        if (outputAmount < _minOutputAmount) {
            revert InsufficientOutputAmount(outputAmount, _minOutputAmount);
        }

        // Transfer tokens - this needs to match what SecuritizeOffRamp does
        IERC20(liquidityToken).transfer(msg.sender, outputAmount);
        IDSToken(asset).transferFrom(msg.sender, address(this), amount);

        // Emit event for consistency
        emit RedemptionCompleted(msg.sender, amount, outputAmount, 1); // Mock rate of 1 for simplicity
    }

    function updateLiquidityProvider(address _liquidityProvider) external {
        liquidityProvider = ILiquidityProvider(_liquidityProvider);
    }

    function updateNavProvider(address _navProvider) external {
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /*
     *  1:1 redeem mock - simplified for testing
     */
    function calculateLiquidityTokenAmount(uint256 _amount) public pure returns (uint256) {
        // For mock purposes, we'll use a simple 1:1 conversion
        // The real implementation would adjust for decimals
        return _amount;
    }

    // Events needed for interface compatibility
    event RedemptionFeeUpdated(uint256 oldFee, uint256 newFee);
}
