/**
 * Copyright 2026 Securitize Inc. All rights reserved.
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

import {IThirdPartyOffRamp} from "./IThirdPartyOffRamp.sol";
import {BaseOffRamp} from "./BaseOffRamp.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {TokenCalculator} from "./TokenCalculator.sol";

/**
 * @title ThirdPartyOffRamp
 * @notice Operator-gated off-ramp that redeems an RWA asset for a liquidity token
 *         by routing an atomic 1:1 swap through a Grove Basin liquidity provider.
 * @dev    Reuses the shared two-step redemption flow: the asset is pulled from the investor and
 *         handed to the liquidity provider, which swaps it via Grove Basin and forwards the
 *         liquidity token back to this contract for delivery to the investor (minus fee).
 */
contract ThirdPartyOffRamp is IThirdPartyOffRamp, BaseOffRamp {
    string public constant NAME = "ThirdPartyOffRamp";
    string public constant VERSION = "1";

    /**
     * @dev Denominator for tolerance math; 100_000 represents 100% (1_000 == 1%).
     */
    uint256 public constant TOLERANCE_DENOMINATOR = 100_000;

    /**
     * @dev Default redeem tolerance applied on initialization (0 == exact NAV match required).
     */
    uint256 public constant DEFAULT_REDEEM_TOLERANCE = 0;

    ISecuritizeNavProvider public navProvider;

    /**
     * @dev Tolerance applied to the NAV-derived expected liquidity value, scaled to
     *      TOLERANCE_DENOMINATOR. Bounds the liquidity value returned by Grove Basin to an
     *      acceptable range around the Securitize NAV expectation.
     */
    uint256 public redeemTolerance;

    /**
     * @dev Throws if the NAV rate is zero or not set.
     */
    modifier nonZeroNavRate() {
        if (navProvider.rate() == 0) {
            revert NonZeroNavRateError();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the ThirdPartyOffRamp implementation.
     * @param _asset DS asset address (e.g. BUIDL).
     * @param _navProvider NAV provider address (returns the 1:1 parity rate for the pair).
     * @param _feeManager Fee manager address.
     * @param _assetBurn Must be false; the asset is the swap input and cannot be burned.
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public override initializer onlyProxy addressNonZero(_navProvider) {
        if (_assetBurn) {
            revert AssetBurnNotSupportedError();
        }
        __BaseOffRamp_init(_asset, _feeManager, false, NAME, VERSION);
        navProvider = ISecuritizeNavProvider(_navProvider);
        redeemTolerance = DEFAULT_REDEEM_TOLERANCE;

        // Grove Basin redemptions only support the two-step transfer flow.
        twoStepTransfer = true;
    }

    /**
     * @notice Sets the redeem tolerance applied to the NAV-derived expected liquidity value.
     * @dev The tolerance defines the accepted band [expected * (1 - t), expected * (1 + t)] around
     *      the Securitize NAV expectation, where t = _tolerance / TOLERANCE_DENOMINATOR.
     * @param _tolerance New tolerance scaled to TOLERANCE_DENOMINATOR (100_000 == 100%).
     */
    function setRedeemTolerance(uint256 _tolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_tolerance > TOLERANCE_DENOMINATOR) {
            revert InvalidToleranceError(_tolerance);
        }
        emit RedeemToleranceUpdated(redeemTolerance, _tolerance);
        redeemTolerance = _tolerance;
    }

    /**
     * @notice Updates the NAV provider address.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) public onlyRole(DEFAULT_ADMIN_ROLE) addressNonZero(_navProvider) {
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @notice Calculates liquidity token received for an asset amount (after fees).
     * @param _assetAmount Asset amount to redeem.
     * @return The amount of liquidity token after fees.
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
     * @notice Calculates liquidity token before fees for an asset amount.
     * @param _assetAmount Asset amount to redeem.
     * @return Liquidity token before deducting fees.
     */
    function calculateLiquidityTokenAmountBeforeFee(
        uint256 _assetAmount
    ) public view override nonZeroLiquidityProvider returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        return
            TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
                _assetAmount,
                rate,
                liquidityDecimals,
                assetDecimals
            );
    }

    /**
     * @notice Redeems an investor's asset for the liquidity token via Grove Basin.
     * @dev Operator-gated: the investor authorizes the redemption off-chain and grants this
     *      contract an allowance over the asset. The swap delivers the liquidity token in the
     *      same block.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity token the investor must receive (slippage guard).
     * @param _investorWallet Wallet that owns the asset and receives the liquidity token.
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet
    ) public override whenNotPaused onlyRole(OPERATOR_ROLE) {
        if (!twoStepTransfer) {
            revert OneStepRedemptionNotSupportedError();
        }

        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, rate, _investorWallet);

        _validateRedeemTolerance(_assetAmount, liquidityValue);

        emit RedemptionCompleted(
            _investorWallet,
            _assetAmount,
            liquidityValue,
            rate,
            fee,
            address(liquidityProvider.liquidityToken())
        );

        emit GroveBasinRedemption(_investorWallet, _assetAmount, liquidityValue, _msgSender());
    }

    /**
     * @notice Validates the redeemed liquidity value against the NAV-derived tolerance band.
     * @dev The expected value is the net (after fee) liquidity amount computed from the Securitize
     *      NAV provider. The accepted band is [expected * (1 - t), expected * (1 + t)] where
     *      t = redeemTolerance / TOLERANCE_DENOMINATOR. Reverts when the delivered value falls
     *      outside the band so a divergent Grove Basin NAV cannot settle at unacceptable terms.
     * @param _assetAmount Asset amount redeemed.
     * @param _liquidityValue Net liquidity value delivered by the redemption.
     */
    function _validateRedeemTolerance(uint256 _assetAmount, uint256 _liquidityValue) private view {
        uint256 expected = calculateLiquidityTokenAmount(_assetAmount);
        uint256 tolerance = redeemTolerance;
        uint256 maxTolerable = (expected * (TOLERANCE_DENOMINATOR + tolerance)) / TOLERANCE_DENOMINATOR;
        uint256 minTolerable = (expected * (TOLERANCE_DENOMINATOR - tolerance)) / TOLERANCE_DENOMINATOR;

        if (_liquidityValue > maxTolerable) {
            revert RedeemMaxToleranceExceededError(_liquidityValue, maxTolerable);
        }
        if (_liquidityValue < minTolerable) {
            revert RedeemMinToleranceExceededError(_liquidityValue, minTolerable);
        }
    }
}
