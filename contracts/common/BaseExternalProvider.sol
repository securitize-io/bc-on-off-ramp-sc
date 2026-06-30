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

/**
 * @title BaseExternalProvider
 * @notice Shared base for providers that source the counter-asset by swapping through Grove Basin
 *         (PSM3): the on-ramp {ExternalAssetProvider} (USDC in, asset out) and the off-ramp
 *         {ExternalLiquidityProvider} (asset in, USDC out).
 * @dev    Holds the Grove Basin handle, the referral code and the NAV-divergence tolerance, and
 *         centralizes the configuration validation ({_validateGroveBasinConfig}) and the rate-band
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
    /// @dev Denominator for {redeemTolerance}; 100_000 equals 100%.
    uint256 public constant TOLERANCE_DENOMINATOR = 100_000;

    /// @dev Default {redeemTolerance} set on initialization (1_000 = 1%).
    uint256 public constant DEFAULT_REDEEM_TOLERANCE = 1_000;

    /**
     * @dev Grove Basin (PSM3) contract used to perform the swap.
     */
    IGroveBasin public externalProvider;

    /**
     * @dev Referral code forwarded to Grove Basin on each swap.
     */
    uint256 public referralCode;

    /**
     * @dev Maximum allowed divergence between Securitize NAV and Grove Basin preview quotes.
     *      Expressed in units of {TOLERANCE_DENOMINATOR} (1_000 = 1%).
     */
    uint256 public redeemTolerance;

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
        redeemTolerance = DEFAULT_REDEEM_TOLERANCE;
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
     */
    function setRedeemTolerance(uint256 _redeemTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_redeemTolerance > TOLERANCE_DENOMINATOR) {
            revert InvalidRedeemToleranceError(_redeemTolerance);
        }
        emit RedeemToleranceUpdated(redeemTolerance, _redeemTolerance);
        redeemTolerance = _redeemTolerance;
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
        _validateGroveBasinConfig(IGroveBasin(_groveBasin));
        externalProvider = IGroveBasin(_groveBasin);
    }

    /**
     * @dev Reverts when a Grove Basin candidate does not match this integration's token wiring.
     *      The liquidity token must match Grove Basin's `collateralToken` and the asset must match
     *      `creditToken`.
     * @param candidate Grove Basin contract to validate.
     */
    function _validateGroveBasinConfig(IGroveBasin candidate) internal view {
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
     * @dev Reverts when the Grove Basin preview falls outside the NAV tolerance band.
     * @param navQuote Securitize NAV quote before fees.
     * @param gbPreview Grove Basin preview quote for the same input amount.
     */
    function _validateRateBand(uint256 navQuote, uint256 gbPreview) internal view {
        uint256 tolerance = redeemTolerance;
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
