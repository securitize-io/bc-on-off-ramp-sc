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

import {BaseContract} from "./BaseContract.sol";
import {IExternalProvider} from "./IExternalProvider.sol";
import {IGroveBasin} from "../off-ramp/third-party-contracts/IGroveBasin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BaseExternalProvider
 * @notice Shared base for providers that source the counter-asset by swapping through Grove Basin
 *         (PSM3): the on-ramp {ExternalAssetProvider} (USDC in, asset out) and the off-ramp
 *         {ExternalLiquidityProvider} (asset in, USDC out).
 * @dev    Holds the Grove Basin handle, the referral code and the NAV-divergence tolerance, and
 *         centralizes the configuration validation ({_validateExternalProviderConfig}) and the rate-band
 *         protection ({_validateRateBand}). Token wiring is identical in both directions:
 *         the liquidity token must be Grove Basin's `collateralToken` and the asset must be its
 *         `creditToken`; concrete providers expose those addresses through {_expectedCollateralToken}
 *         and {_expectedCreditToken}.
 *
 *         Storage layout note: this base sits between {BaseContract} and the concrete provider, so
 *         it occupies the storage slots right after {BaseContract}. A reserved gap keeps room for
 *         future shared state without disturbing the concrete providers' own variables.
 */
abstract contract BaseExternalProvider is IExternalProvider, BaseContract {
    using SafeERC20 for IERC20;

    /// @dev Denominator for {rateTolerance}; 100_000 equals 100%.
    uint256 public constant TOLERANCE_DENOMINATOR = 100_000;

    /// @dev Default {rateTolerance} set on initialization (1_000 = 1%).
    uint256 public constant DEFAULT_RATE_TOLERANCE = 1_000;

    /**
     * @dev Grove Basin (PSM3) contract used to perform the swap.
     */
    IGroveBasin public externalProvider;

    /**
     * @dev Referral code forwarded to Grove Basin on each swap.
     */
    uint256 public referralCode;

    /**
     * @dev Trust placed in the external provider (Grove Basin) when its preview quote is checked
     *      against the Securitize NAV. Expressed in units of {TOLERANCE_DENOMINATOR} (1_000 = 1%).
     *      Three regimes, enforced in {_validateRateBand}:
     *      - `0`: zero trust. The external quote must equal the NAV exactly (strict equality);
     *        any divergence reverts. Since Grove Basin fees/rounding make an exact match practically
     *        impossible, `0` reverts almost every swap and acts as a de-facto kill switch for the
     *        external provider rather than a tight band (the smallest meaningful band is `1`).
     *      - `TOLERANCE_DENOMINATOR` (100%): full trust. The band check is skipped entirely.
     *      - `0 < rateTolerance < TOLERANCE_DENOMINATOR`: the quote must fall within the symmetric
     *        tolerance band around the NAV.
     *
     *      OPERATIONAL REQUIREMENT — the band must absorb Grove Basin's fee. {_validateRateBand}
     *      compares the Securitize NAV taken *before* fees (the off-ramp's
     *      {ISecuritizeOffRamp.calculateLiquidityTokenAmountBeforeFee}, the on-ramp's
     *      {ExternalAssetProvider._assetForLiquidity}) against Grove Basin's preview, which is already
     *      *net* of Grove Basin's {IGroveBasin.redemptionFee} (redemptions) or
     *      {IGroveBasin.purchaseFee} (subscriptions). The fee is therefore charged only to the lower
     *      side of the band, so the effective downside tolerance is `rateTolerance - feeFraction`.
     *      When Grove Basin's fee approaches or exceeds `rateTolerance`, legitimate swaps revert with
     *      {MinRateDivergenceError} even though the underlying rates are aligned (a liveness/DoS
     *      condition, not a mispricing — the swap floor still protects the amount).
     *
     *      Admins MUST therefore keep `rateTolerance >= expectedGroveFeeFraction + margin`. Grove
     *      Basin's {IGroveBasin.maxFee} is the worst case (up to 5%); convert Grove BPS into
     *      {TOLERANCE_DENOMINATOR} units by multiplying by `TOLERANCE_DENOMINATOR / IGroveBasin.BPS()`
     *      (e.g. a 5% = 500 BPS max fee maps to 5_000). Note the trade-off: widening the band to
     *      absorb the fee equally widens the upper side, weakening protection against a genuinely
     *      diverged Grove Basin oracle, so size the margin deliberately rather than maximally.
     */
    uint256 public rateTolerance;

    /// @dev Reserved storage to allow future shared variables without shifting child layout.
    uint256[47] private __gap;

    /**
     * @dev Initializes the shared Grove Basin configuration. Concrete providers MUST set their
     *      liquidity and asset token references before calling this, because the candidate
     *      validation reads them through {_expectedCollateralToken}/{_expectedCreditToken}.
     * @param _groveBasin Grove Basin (PSM3) contract used to perform swaps.
     */
    function __BaseExternalProvider_init(address _groveBasin) internal onlyInitializing {
        _setExternalProvider(_groveBasin);
        rateTolerance = DEFAULT_RATE_TOLERANCE;
    }

    /**
     * @inheritdoc IExternalProvider
     */
    function rescueTokens(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_to == address(0)) {
            revert NonZeroAddressError();
        }
        IERC20(_token).safeTransfer(_to, _amount);
        emit TokensRescued(_token, _to, _amount);
    }

    /**
     * @inheritdoc IExternalProvider
     */
    function setExternalProvider(address _groveBasin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(externalProvider);
        _setExternalProvider(_groveBasin);
        emit ExternalProviderUpdated(old, _groveBasin);
    }

    /**
     * @inheritdoc IExternalProvider
     */
    function setReferralCode(uint256 _referralCode) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ReferralCodeUpdated(referralCode, _referralCode);
        referralCode = _referralCode;
    }

    /**
     * @inheritdoc IExternalProvider
     * @dev The configured value MUST cover Grove Basin's fee plus a margin
     *      (`rateTolerance >= expectedGroveFeeFraction + margin`); otherwise legitimate swaps revert
     *      at {_validateRateBand} once Grove Basin enables a fee near the band. See {rateTolerance}
     *      for the full operational requirement and the upper-side trade-off.
     */
    function setRateTolerance(uint256 _rateTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_rateTolerance > TOLERANCE_DENOMINATOR) {
            revert InvalidRateToleranceError(_rateTolerance);
        }
        emit RateToleranceUpdated(rateTolerance, _rateTolerance);
        rateTolerance = _rateTolerance;
    }

    /**
     * @dev Liquidity token expected to match Grove Basin's `collateralToken`.
     * @return The liquidity token address.
     */
    function _expectedCollateralToken() internal view virtual returns (address);

    /**
     * @dev Asset token expected to match Grove Basin's `creditToken`.
     * @return The asset token address.
     */
    function _expectedCreditToken() internal view virtual returns (address);

    /**
     * @dev Validates and stores a Grove Basin candidate against this integration's token wiring.
     * @param _groveBasin New Grove Basin (PSM3) address.
     */
    function _setExternalProvider(address _groveBasin) private {
        if (_groveBasin == address(0)) {
            revert NonZeroAddressError();
        }
        _validateExternalProviderConfig(IGroveBasin(_groveBasin));
        externalProvider = IGroveBasin(_groveBasin);
    }

    /**
     * @dev Reverts when a Grove Basin candidate does not match this integration's token wiring.
     *      The liquidity token must match Grove Basin's `collateralToken` and the asset must match
     *      `creditToken`.
     * @param candidate Grove Basin contract to validate.
     */
    function _validateExternalProviderConfig(IGroveBasin candidate) internal view {
        address candidateAddr = address(candidate);
        if (candidateAddr.code.length == 0) {
            revert NotAContract(candidateAddr);
        }
        address expectedCollateral = _expectedCollateralToken();
        if (candidate.collateralToken() != expectedCollateral) {
            revert CollateralTokenMismatch(expectedCollateral, candidate.collateralToken());
        }
        address expectedCredit = _expectedCreditToken();
        if (candidate.creditToken() != expectedCredit) {
            revert CreditTokenMismatch(expectedCredit, candidate.creditToken());
        }
        if (candidate.pocket() == address(0)) {
            revert PocketZeroAddressError();
        }
    }

    /**
     * @dev Enforces the configured trust in the Grove Basin preview against the Securitize NAV.
     *      Behaviour is driven by {rateTolerance}:
     *      - `TOLERANCE_DENOMINATOR` (100%): full trust, the check is skipped.
     *      - `0`: zero trust, the preview must equal the NAV exactly.
     *      - otherwise: the preview must fall within the symmetric tolerance band around the NAV.
     *
     *      Asymmetry note: `navQuote` is a *pre-fee* NAV figure while `gbPreview` is already *net* of
     *      Grove Basin's fee, so the fee only ever pushes `gbPreview` toward `minBand`. `rateTolerance`
     *      must be configured to cover Grove Basin's fee (see {rateTolerance}); otherwise this reverts
     *      with {MinRateDivergenceError} on fee-only divergence, not a genuine rate dislocation.
     * @param navQuote Securitize NAV quote before fees.
     * @param gbPreview Grove Basin preview quote (net of Grove Basin's fee) for the same input amount.
     */
    function _validateRateBand(uint256 navQuote, uint256 gbPreview) internal view {
        uint256 tolerance = rateTolerance;

        // Full trust: skip the divergence check entirely.
        if (tolerance == TOLERANCE_DENOMINATOR) {
            return;
        }

        // Zero trust: require the external preview to match the NAV exactly.
        if (tolerance == 0) {
            if (gbPreview < navQuote) {
                revert MinRateDivergenceError(navQuote, gbPreview, tolerance);
            }
            if (gbPreview > navQuote) {
                revert MaxRateDivergenceError(navQuote, gbPreview, tolerance);
            }
            return;
        }

        // Partial trust: enforce the symmetric tolerance band around the NAV.
        uint256 minBand = (navQuote * (TOLERANCE_DENOMINATOR - tolerance)) / TOLERANCE_DENOMINATOR;
        uint256 maxBand = (navQuote * (TOLERANCE_DENOMINATOR + tolerance)) / TOLERANCE_DENOMINATOR;

        if (gbPreview < minBand) {
            revert MinRateDivergenceError(navQuote, gbPreview, tolerance);
        }
        if (gbPreview > maxBand) {
            revert MaxRateDivergenceError(navQuote, gbPreview, tolerance);
        }
    }

    /**
     * @dev Wallet whose balance reflects swapable inventory of `token` in Grove Basin.
     *      Mirrors Grove Basin's custody model: the `pocket` only custodies the `swapToken`, while
     *      the `collateralToken` and `creditToken` are held by the Grove Basin contract itself.
     * @param token Token to resolve the custodian for.
     * @return custodian Wallet whose `token` balance reflects swapable inventory in Grove Basin.
     */
    function _custodianOf(address token) internal view returns (address custodian) {
        custodian = token == externalProvider.swapToken() ? externalProvider.pocket() : address(externalProvider);
        if (custodian == address(0)) {
            revert PocketZeroAddressError();
        }
    }
}
