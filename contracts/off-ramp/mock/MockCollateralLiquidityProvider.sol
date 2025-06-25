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

import {ICollateralLiquidityProvider} from "../liquidity/ICollateralLiquidityProvider.sol";
import {ILiquidityProvider} from "../liquidity/ILiquidityProvider.sol";
import {ISecuritizeRedemption} from "../redemption/ISecuritizeRedemption.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock for CollateralLiquidityProvider
contract MockCollateralLiquidityProvider is ICollateralLiquidityProvider {
    IERC20 public liquidityToken;
    address public recipient;
    ISecuritizeRedemption public securitizeRedemption;
    ISecuritizeRedemption public externalCollateralRedemption;
    address public collateralProvider;
    bool public isPaused;

    constructor(address _liquidityToken, address _recipient, address _securitizeRedemption) {
        liquidityToken = IERC20(_liquidityToken);
        recipient = _recipient;
        securitizeRedemption = ISecuritizeRedemption(_securitizeRedemption);
    }

    function initialize(address _recipient, address _liquidityToken, address _securitizeRedemption) external override {
        recipient = _recipient;
        liquidityToken = IERC20(_liquidityToken);
        securitizeRedemption = ISecuritizeRedemption(_securitizeRedemption);
    }

    function setExternalCollateralRedemption(address _externalCollateralRedemption) external override {
        externalCollateralRedemption = ISecuritizeRedemption(_externalCollateralRedemption);
        emit ExternalCollateralRedemptionUpdated(address(0), _externalCollateralRedemption);
    }

    function setCollateralProvider(address _collateralProvider) external override {
        address oldProvider = collateralProvider;
        collateralProvider = _collateralProvider;
        emit CollateralProviderUpdated(oldProvider, _collateralProvider);
    }

    function supplyTo(address _redeemer, uint256 _amount, uint256 /*_minOutputAmount*/) external override {
        require(!isPaused, "Contract is paused");
        require(msg.sender == address(securitizeRedemption), "Unauthorized caller");

        // This is a mock - we just simulate liquidity transfer
        liquidityToken.transfer(_redeemer, _amount);
    }

    function availableLiquidity() external view override returns (uint256) {
        return liquidityToken.balanceOf(address(this));
    }

    // For testing pause functionality
    function setPaused(bool _paused) external {
        isPaused = _paused;
    }
}
