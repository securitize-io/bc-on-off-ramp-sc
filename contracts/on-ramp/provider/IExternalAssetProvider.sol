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
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IAssetProvider} from "./IAssetProvider.sol";
import {IExternalProvider} from "../../common/IExternalProvider.sol";

/**
 * @title IExternalAssetProvider
 * @notice Asset provider that sources the asset by atomically swapping the liquidity token (USDC)
 *         received from the on-ramp for the asset (e.g. BUIDL) through Grove Basin (PSM3).
 * @dev    The swap uses {IGroveBasin.swapExactIn} bound to the subscription's net liquidity (via
 *         {supplyExactIn}), not the whole on-hand balance, so a stray liquidity-token donation cannot
 *         change the swapped amount or revert the subscription. The companion
 *         {ExternalAssetProviderOnRamp} sizes the expected asset amount from {quoteAsset} (the same
 *         Grove Basin preview, over the same net liquidity), so the amount the on-ramp forwards in
 *         two-step equals what Grove Basin delivers — no dust, no shortfall. The provider re-derives
 *         the quote for the net liquidity and reverts with {UnexpectedSwapOutputError} on an
 *         inconsistent NAV state, and cross-checks the quote against the Securitize NAV tolerance band.
 */
interface IExternalAssetProvider is IAssetProvider, IExternalProvider {
    /**
     * @dev Emitted when the authorized on-ramp contract is updated.
     * @param oldOnRamp Previous on-ramp address.
     * @param newOnRamp New on-ramp address.
     */
    event SecuritizeOnRampUpdated(address oldOnRamp, address newOnRamp);

    /**
     * @dev Emitted when the NAV provider used for the Grove Basin cross-check is updated.
     * @param oldProvider Previous NAV provider address.
     * @param newProvider New NAV provider address.
     */
    event NavProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Thrown when there is no liquidity-token balance available to swap.
     * @dev Selector: 0xa80f0106
     */
    error ZeroAmountToSwap();

    /**
     * @dev Thrown when Grove Basin cannot satisfy the requested asset output.
     * @param requested Asset amount requested from Grove Basin.
     * @param available Asset amount available at the Grove Basin asset custodian.
     * @dev Selector: 0x48b12e37
     */
    error InsufficientAssetLiquidity(uint256 requested, uint256 available);

    /**
     * @dev Thrown when the Grove Basin exact-in quote for this subscription's net liquidity does not
     *      equal the expected asset amount the on-ramp passed. The on-ramp sizes that amount from
     *      {quoteAsset} over the same net liquidity, so a mismatch signals an inconsistent NAV/Grove
     *      Basin state between the on-ramp quote and the swap; the call reverts instead of delivering
     *      an amount the buyer did not agree to.
     * @param expectedAssetAmount Asset amount the on-ramp expects for this subscription.
     * @param quotedAssetAmount Asset amount Grove Basin would deliver for the net liquidity.
     * @dev Selector: 0x2c63620e
     */
    error UnexpectedSwapOutputError(uint256 expectedAssetAmount, uint256 quotedAssetAmount);

    /**
     * @dev Thrown when the on-hand liquidity balance is below the net liquidity the on-ramp intends
     *      to swap for this subscription (i.e. the net was not settled on the provider).
     * @param required Net liquidity the on-ramp intends to swap.
     * @param available Liquidity-token balance currently held by the provider.
     * @dev Selector: 0x9a0f5d2e
     */
    error InsufficientLiquidityToSwap(uint256 required, uint256 available);

    /**
     * @notice Proxy initializer.
     * @param _liquidityToken Liquidity token (stablecoin) supplied by the investor.
     * @param _asset Asset (DSToken) delivered to the investor.
     * @param _navProvider Securitize NAV provider (must match the on-ramp's NAV provider).
     * @param _groveBasin Grove Basin (PSM3) contract used to perform the swap.
     */
    function initialize(address _liquidityToken, address _asset, address _navProvider, address _groveBasin) external;

    /**
     * @notice Swaps exactly `_netLiquidity` of the liquidity token held by this contract for the
     *         asset through Grove Basin, delivering it to `_buyer`.
     * @dev Called by the companion {ExternalAssetProviderOnRamp} after the net liquidity has been
     *      settled on this contract. The swap is bound to `_netLiquidity` (the amount the on-ramp
     *      just transferred) rather than the whole on-hand balance, so a stray token donation neither
     *      changes the swapped amount nor reverts the subscription; any surplus stays on the provider
     *      and is recoverable via {rescueTokens}.
     * @param _buyer Recipient of the asset (the investor in single-step, the on-ramp in two-step).
     * @param _netLiquidity Net liquidity (after the on-ramp fee) to swap for this subscription.
     * @param _expectedAssetAmount Asset amount (before fee) the on-ramp expects for this subscription.
     */
    function supplyExactIn(address _buyer, uint256 _netLiquidity, uint256 _expectedAssetAmount) external;

    /**
     * @notice Sets the on-ramp contract authorized to request assets.
     * @dev Set after deployment to break the deploy-time circular dependency: the on-ramp is
     *      initialized with `custodianWallet == address(this)`, so the provider must exist first.
     * @param _securitizeOnRamp New authorized on-ramp address.
     */
    function setSecuritizeOnRamp(address _securitizeOnRamp) external;

    /**
     * @notice Updates the Securitize NAV provider used to cross-check the Grove Basin quote against
     *         the NAV tolerance band.
     * @dev Must be rotated together with the on-ramp's NAV provider (see
     *      {SecuritizeOnRamp.updateNavProvider}) so the two stay aligned: the provider prices the
     *      NAV side of the tolerance band ({_validateRateBand}) from this reference, and a divergence
     *      from the on-ramp's NAV would revert every subscription. Without this setter, realigning a
     *      rotated NAV provider would require a UUPS upgrade. Admin-gated; reverts on the zero address.
     * @param _navProvider New NAV provider address (must be non-zero).
     */
    function updateNavProvider(address _navProvider) external;

    /**
     * @notice The liquidity token (stablecoin) swapped into Grove Basin (e.g. USDC).
     * @return The liquidity token.
     */
    function liquidityToken() external view returns (IERC20Metadata);

    /**
     * @notice The Securitize NAV provider used to price the swap.
     * @return The NAV provider.
     */
    function navProvider() external view returns (ISecuritizeNavProvider);

    /**
     * @notice Grove Basin quote: asset amount delivered for swapping `_netLiquidity` of the liquidity
     *         token in. The on-ramp uses this to size the expected asset amount so the amount it
     *         forwards in two-step equals what the swap in {supplyTo} delivers.
     * @param _netLiquidity Net liquidity amount (after the on-ramp fee) to be swapped.
     * @return The asset amount Grove Basin would deliver for `_netLiquidity`.
     */
    function quoteAsset(uint256 _netLiquidity) external view returns (uint256);

    /**
     * @notice Returns a best-effort upper bound on the asset amount available for purchases in Grove Basin.
     * @dev Upper bound, not exact deliverable capacity: it does NOT net out non-deliverable portions
     *      (seed deposit, fee-claimer accrual, collateral reserved against pending redemptions) and does
     *      NOT model the asset DSToken compliance rules that may reject the swap output for a specific
     *      buyer. See {ExternalAssetProvider.availableAsset} for the full semantics.
     * @return A best-effort upper bound on the asset amount available at the Grove Basin asset custodian.
     */
    function availableAsset() external view returns (uint256);
}
