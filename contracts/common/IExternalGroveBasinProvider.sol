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

import {IGroveBasin} from "../off-ramp/third-party-contracts/IGroveBasin.sol";
import {Errors} from "./Errors.sol";

/**
 * @title IExternalGroveBasinProvider
 * @notice Common surface shared by the on-ramp and off-ramp providers that route swaps through
 *         Grove Basin (PSM3). Both directions wire {liquidityToken} as Grove Basin's
 *         `collateralToken` and {asset} as its `creditToken`, and protect each swap with a NAV vs
 *         Grove Basin preview tolerance band.
 */
interface IExternalGroveBasinProvider is Errors {
    /**
     * @dev Emitted when the owner updates the Grove Basin contract address.
     * @param oldGroveBasin Previous Grove Basin address.
     * @param newGroveBasin New Grove Basin address.
     */
    event ExternalProviderUpdated(address oldGroveBasin, address newGroveBasin);

    /**
     * @dev Emitted when the owner updates the Grove Basin referral code.
     * @param oldReferralCode Previous referral code.
     * @param newReferralCode New referral code.
     */
    event ReferralCodeUpdated(uint256 oldReferralCode, uint256 newReferralCode);

    /**
     * @dev Emitted when the owner updates the NAV vs Grove Basin preview tolerance.
     * @param oldTolerance Previous tolerance value.
     * @param newTolerance New tolerance value.
     */
    event RedeemToleranceUpdated(uint256 oldTolerance, uint256 newTolerance);

    /**
     * @dev Thrown when {redeemTolerance} exceeds {TOLERANCE_DENOMINATOR}.
     * @param tolerance Invalid tolerance value.
     * @dev Selector: 0x290b405f
     */
    error InvalidRedeemToleranceError(uint256 tolerance);

    /**
     * @dev Thrown when a Grove Basin candidate address has no contract bytecode.
     * @param account Address that is not a contract.
     * @dev Selector: 0x8a8b41ec
     */
    error NotAContract(address account);

    /**
     * @dev Thrown when a Grove Basin candidate's `collateralToken` does not match {liquidityToken}.
     * @param expected Configured liquidity token address.
     * @param actual Candidate `collateralToken` address.
     * @dev Selector: 0x58534988
     */
    error CollateralTokenMismatch(address expected, address actual);

    /**
     * @dev Thrown when a Grove Basin candidate's `creditToken` does not match the configured asset.
     * @param expected Configured asset token address.
     * @param actual Candidate `creditToken` address.
     * @dev Selector: 0x9e3b0bcb
     */
    error CreditTokenMismatch(address expected, address actual);

    /**
     * @dev Thrown when Grove Basin reports a zero-address custodian (pocket).
     * @dev Selector: 0x9a72c107
     */
    error PocketZeroAddressError();

    /**
     * @dev Thrown when the Grove Basin preview is below the minimum NAV tolerance band.
     * @param navQuote Securitize NAV quote before fees.
     * @param groveBasinPreview Grove Basin preview quote.
     * @param tolerance Active {redeemTolerance} value.
     * @dev Selector: 0x2cf03264
     */
    error MinRateDivergenceError(uint256 navQuote, uint256 groveBasinPreview, uint256 tolerance);

    /**
     * @dev Thrown when the Grove Basin preview is above the maximum NAV tolerance band.
     * @param navQuote Securitize NAV quote before fees.
     * @param groveBasinPreview Grove Basin preview quote.
     * @param tolerance Active {redeemTolerance} value.
     * @dev Selector: 0xde75f695
     */
    error MaxRateDivergenceError(uint256 navQuote, uint256 groveBasinPreview, uint256 tolerance);

    /**
     * @notice Sets a new Grove Basin contract address.
     * @param _groveBasin New Grove Basin (PSM3) address.
     */
    function setExternalProvider(address _groveBasin) external;

    /**
     * @notice Sets the referral code forwarded to Grove Basin on each swap.
     * @param _referralCode New referral code.
     */
    function setReferralCode(uint256 _referralCode) external;

    /**
     * @notice Sets the maximum allowed divergence between Securitize NAV and Grove Basin preview quotes.
     * @param _redeemTolerance New tolerance in units of {TOLERANCE_DENOMINATOR} (1_000 = 1%).
     */
    function setRedeemTolerance(uint256 _redeemTolerance) external;

    /**
     * @notice Denominator for {redeemTolerance}; 100_000 equals 100%.
     * @return The tolerance denominator.
     */
    function TOLERANCE_DENOMINATOR() external view returns (uint256);

    /**
     * @notice Default {redeemTolerance} applied on initialization (1_000 = 1%).
     * @return The default tolerance value.
     */
    function DEFAULT_REDEEM_TOLERANCE() external view returns (uint256);

    /**
     * @notice Maximum allowed divergence between Securitize NAV and Grove Basin preview quotes.
     * @return The active tolerance value.
     */
    function redeemTolerance() external view returns (uint256);

    /**
     * @notice The referral code forwarded to Grove Basin on each swap.
     * @return The referral code.
     */
    function referralCode() external view returns (uint256);

    /**
     * @notice The Grove Basin (PSM3) contract used to perform swaps.
     * @return The Grove Basin contract.
     */
    function externalProvider() external view returns (IGroveBasin);
}
