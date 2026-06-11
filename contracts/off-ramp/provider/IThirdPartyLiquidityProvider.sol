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

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ILiquidityProvider} from "./ILiquidityProvider.sol";
import {IGroveBasin} from "../third-party-contracts/IGroveBasin.sol";

/**
 * @title IThirdPartyLiquidityProvider
 * @notice Liquidity provider that sources liquidity by atomically swapping the redeemed asset
 *         for the liquidity token through Grove Basin (PSM3) at a strict 1:1 peg.
 */
interface IThirdPartyLiquidityProvider is ILiquidityProvider {
    /**
     * @dev Emitted when the owner updates the Grove Basin contract address.
     * @param oldGroveBasin Previous Grove Basin address.
     * @param newGroveBasin New Grove Basin address.
     */
    event GroveBasinUpdated(address oldGroveBasin, address newGroveBasin);

    /**
     * @dev Emitted when the owner updates the Grove Basin referral code.
     * @param oldReferralCode Previous referral code.
     * @param newReferralCode New referral code.
     */
    event ReferralCodeUpdated(uint256 oldReferralCode, uint256 newReferralCode);

    /**
     * @dev Thrown when there is no asset balance available to swap.
     */
    error ZeroAmountToSwap();

    /**
     * @notice Proxy initializer.
     * @param _liquidityToken Liquidity token (stablecoin) delivered to the redeemer.
     * @param _securitizeOffRamp Off-ramp contract authorized to request liquidity.
     * @param _groveBasin Grove Basin (PSM3) contract used to perform the swap.
     */
    function initialize(address _liquidityToken, address _securitizeOffRamp, address _groveBasin) external;

    /**
     * @notice Sets a new Grove Basin contract address.
     * @param _groveBasin New Grove Basin (PSM3) address.
     */
    function setGroveBasin(address _groveBasin) external;

    /**
     * @notice Sets the referral code forwarded to Grove Basin on each swap.
     * @param _referralCode New referral code.
     */
    function setReferralCode(uint256 _referralCode) external;

    /**
     * @notice The Grove Basin (PSM3) contract used to perform swaps.
     * @return The Grove Basin contract.
     */
    function groveBasin() external view returns (IGroveBasin);

    /**
     * @notice The asset token swapped into Grove Basin (e.g. BUIDL).
     * @return The asset token.
     */
    function assetToken() external view returns (IERC20Metadata);

    /**
     * @notice The referral code forwarded to Grove Basin on each swap.
     * @return The referral code.
     */
    function referralCode() external view returns (uint256);
}
