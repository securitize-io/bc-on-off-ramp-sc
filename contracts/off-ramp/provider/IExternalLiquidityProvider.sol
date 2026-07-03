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
     * @dev Emitted when the authorized off-ramp is rotated via {setSecuritizeOffRamp}.
     * @param oldOffRamp Previous off-ramp authorized to request liquidity.
     * @param newOffRamp New off-ramp authorized to request liquidity.
     */
    event SecuritizeOffRampUpdated(address oldOffRamp, address newOffRamp);

    /**
     * @dev Thrown when the off-ramp passed to {setSecuritizeOffRamp} redeems a different asset than the
     *      one this provider was initialized with. The provider's {assetToken} is frozen at init, so
     *      rotating to an off-ramp with a mismatched asset is rejected to avoid a stale-asset state.
     * @param expectedAsset Asset this provider swaps into Grove Basin (frozen at init).
     * @param newOffRampAsset Asset the candidate off-ramp redeems.
     */
    error AssetMismatch(address expectedAsset, address newOffRampAsset);

    /**
     * @dev Thrown when there is no asset balance available to swap.
     * @dev Selector: 0xa80f0106
     */
    error ZeroAmountToSwap();

    /**
     * @dev Thrown when the NAV gross the off-ramp expects for the redeemed asset amount does not
     *      equal the NAV gross the provider derives from that same amount, signalling an inconsistent
     *      NAV state between the off-ramp quote and the swap. The swap is bound to the redemption's
     *      own asset amount (not the on-hand balance), so a stray asset donation does not trigger it.
     * @param expectedNavGross NAV gross the off-ramp expects for the current redemption.
     * @param actualNavGross NAV gross the provider derives for the redeemed asset amount.
     * @dev Selector: 0x76a2631c
     */
    error UnexpectedAssetBalanceError(uint256 expectedNavGross, uint256 actualNavGross);

    /**
     * @dev Thrown when the on-hand asset balance is below the asset amount of the current redemption
     *      (i.e. the redeemed asset was not transferred to the provider before the swap).
     * @param required Asset amount the off-ramp intends to swap for this redemption.
     * @param available Asset balance currently held by the provider.
     * @dev Selector: 0x3b8f4a17
     */
    error InsufficientAssetToSwap(uint256 required, uint256 available);

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
     * @notice Rotates the off-ramp authorized to request liquidity from this provider.
     * @dev Restricted to {DEFAULT_ADMIN_ROLE}. The new off-ramp must redeem the same asset this provider
     *      was initialized with ({assetToken}), which is frozen at init; a mismatch reverts with
     *      {AssetMismatch}. Rotation therefore supports swapping the off-ramp implementation for the
     *      same asset (e.g. an off-ramp redeploy) without a UUPS upgrade, but not changing the asset.
     *
     *      This updates only the provider -> off-ramp direction. To complete the wiring the new
     *      off-ramp must also point back to this provider via {IBaseOffRamp.updateLiquidityProvider};
     *      until then redemptions on both off-ramps revert.
     * @param _securitizeOffRamp New off-ramp authorized to request liquidity.
     */
    function setSecuritizeOffRamp(address _securitizeOffRamp) external;

    /**
     * @notice Swaps exactly `_assetAmount` of the asset held by this contract for the liquidity token
     *         through Grove Basin, forwarding the proceeds to `_receiver`.
     * @dev Called by the companion {ExternalLiquidityProviderOffRamp} two-step flow after the redeemed
     *      asset has been transferred here. The swap is bound to `_assetAmount` (the amount this
     *      redemption transferred) rather than the whole on-hand balance, so a stray asset donation
     *      neither changes the swapped amount nor reverts the redemption; any surplus stays on the
     *      provider and is recoverable via {rescueTokens}.
     * @param _receiver Recipient of the liquidity token (the off-ramp contract).
     * @param _assetAmount Asset amount redeemed in this operation, to be swapped through Grove Basin.
     * @param _expectedLiquidityAmount NAV gross (before fee) the off-ramp expects for this redemption.
     * @return amountOut Liquidity token amount delivered by Grove Basin.
     */
    function supplyExactIn(
        address _receiver,
        uint256 _assetAmount,
        uint256 _expectedLiquidityAmount
    ) external returns (uint256 amountOut);

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
