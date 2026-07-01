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
import {IExternalProvider} from "../../common/IExternalProvider.sol";

/**
 * @title IExternalLiquidityProvider
 * @notice Liquidity provider that sources liquidity by atomically swapping the redeemed asset
 *         for the liquidity token through Grove Basin (PSM3) at a strict 1:1 peg.
 */
interface IExternalLiquidityProvider is ILiquidityProvider, IExternalProvider {
    /**
     * @dev Thrown when there is no asset balance available to swap.
     * @dev Selector: 0xa80f0106
     */
    error ZeroAmountToSwap();

    /**
     * @dev Thrown when the on-hand asset balance does not correspond to the asset amount of the
     *      current redemption (e.g. pre-existing or stuck asset sitting on the provider). The
     *      swap is bound to the current redemption by comparing the NAV gross the off-ramp expects
     *      with the NAV gross derived from the provider's on-hand balance; a mismatch means extra
     *      balance would otherwise be swept into the caller's redemption.
     * @param expectedNavGross NAV gross the off-ramp expects for the current redemption.
     * @param actualNavGross NAV gross derived from the provider's on-hand asset balance.
     * @dev Selector: 0x76a2631c
     */
    error UnexpectedAssetBalanceError(uint256 expectedNavGross, uint256 actualNavGross);

    /**
     * @dev Thrown when the linked off-ramp does not have two-step transfer enabled.
     *      {ExternalLiquidityProvider} is incompatible with the single-step redemption flow.
     * @dev Selector: 0x55ab5ab8
     */
    error TwoStepTransferRequired();

    /**
     * @dev Thrown when the linked off-ramp has asset burning enabled.
     *      {ExternalLiquidityProvider} requires the asset to be transferred here for the Grove Basin swap.
     * @dev Selector: 0x2e4ffb57
     */
    error AssetBurnNotSupported();

    /**
     * @notice Proxy initializer.
     * @param _liquidityToken Liquidity token (stablecoin) delivered to the redeemer.
     * @param _securitizeOffRamp Off-ramp contract authorized to request liquidity.
     * @param _groveBasin Grove Basin (PSM3) contract used to perform the swap.
     */
    function initialize(address _liquidityToken, address _securitizeOffRamp, address _groveBasin) external;

    /**
     * @notice The asset token swapped into Grove Basin (e.g. BUIDL).
     * @return The asset token.
     */
    function assetToken() external view returns (IERC20Metadata);

    /**
     * @notice Returns the wallet that holds the liquidity token available for redemptions in Grove Basin.
     * @dev See {ExternalLiquidityProvider.getLiquidityCustodian} for the full custodian semantics.
     * @return custodian Wallet whose liquidity-token balance reflects swapable liquidity in Grove Basin.
     */
    function getLiquidityCustodian() external view returns (address custodian);
}
