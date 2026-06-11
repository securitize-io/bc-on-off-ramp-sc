/**
 * Copyright 2025 Securitize Inc. All rights reserved.
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

import {ISecuritizeOffRamp} from "./ISecuritizeOffRamp.sol";
import {BaseOffRamp} from "./BaseOffRamp.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {IGroveBasin} from "./third-party-contracts/IGroveBasin.sol";

contract SecuritizeGroveBasinOffRamp is ISecuritizeOffRamp, BaseOffRamp {

    string public constant NAME = "SecuritizeGroveBasinOffRamp";
    string public constant VERSION = "1";

    ISecuritizeNavProvider public navProvider;
    IGroveBasin public groveBasin;

    /**
     * @dev Throws if the NAV rate is zero or not set
     */
    modifier nonZeroNavRate() {
        if (navProvider.rate() <= 0) {
            revert NonZeroNavRateError();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes SecuritizeOffRamp implementation.
     * @param _asset DS asset address.
     * @param _navProvider NAV provider address.
     * @param _feeManager Fee manager address.
     * @param _assetBurn Whether redeemed asset is burned.
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public override initializer onlyProxy {
        __BaseOffRamp_init(_asset, _feeManager, _assetBurn, NAME, VERSION);

        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @notice Initializes SecuritizeOffRamp implementation.
     * @param _asset DS asset address.
     * @param _navProvider NAV provider address.
     * @param _feeManager Fee manager address.
     * @param _groveBasin Groove Basin smart contract.
     * @param _assetBurn Whether redeemed asset is burned.
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        address _groveBasin,
        bool _assetBurn
    ) public initializer onlyProxy {
        initialize(_asset, _navProvider, _feeManager, _assetBurn);
        groveBasin = IGroveBasin(_groveBasin);
    }



    /**
     * @notice Updates the NAV provider address.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @notice Calculates liquidity tokens received for an asset amount.
     * @param _assetAmount Asset amount to redeem.
     * @return The amount of liquidity tokens after fees.
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount
    ) public view override nonZeroLiquidityProvider returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        uint256 amountBeforeFee = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            _assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmount = liquidityProvider.calculateEffectiveLiquidityTokenAmount(amountBeforeFee);
        uint256 fee = TokenCalculator.calculateFee(feeManager, effectiveAmount);
        return effectiveAmount - fee;
    }

    /**
     * @notice Calculates liquidity tokens before fees for an asset amount.
     * @param _assetAmount Asset amount to redeem.
     * @return Liquidity tokens before deducting fees.
     */
    function calculateLiquidityTokenAmountBeforeFee(uint256 _assetAmount) public view override nonZeroLiquidityProvider returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        return TokenCalculator.calculateLiquidityTokenAmountBeforeFee(_assetAmount, rate, liquidityDecimals, assetDecimals);
    }

    /**
     * @notice Redeems asset tokens for liquidity tokens using on-chain NAV rate.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount
    )
        public
        override
        whenNotPaused
        nonZeroNavRate
    {
        uint256 rate = navProvider.rate();
        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, rate, _msgSender());

        emit RedemptionCompleted(
            _msgSender(),
            _assetAmount,
            liquidityValue,
            rate,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }
}
