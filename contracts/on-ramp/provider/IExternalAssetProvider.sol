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
import {IExternalGroveBasinProvider} from "../../common/IExternalGroveBasinProvider.sol";

/**
 * @title IExternalAssetProvider
 * @notice Asset provider that sources the asset by atomically swapping the liquidity token (USDC)
 *         received from the on-ramp for the asset (e.g. BUIDL) through Grove Basin (PSM3).
 * @dev    Self-contained: it computes the NAV quote internally (its own {navProvider}) and never
 *         calls back into the on-ramp. The swap uses {IGroveBasin.swapExactOut} so it delivers the
 *         exact asset amount the on-ramp expects, which is what the on-ramp two-step flow forwards
 *         to the investor.
 */
interface IExternalAssetProvider is IAssetProvider, IExternalGroveBasinProvider {
    /**
     * @dev Emitted when the authorized on-ramp contract is updated.
     * @param oldOnRamp Previous on-ramp address.
     * @param newOnRamp New on-ramp address.
     */
    event SecuritizeOnRampUpdated(address oldOnRamp, address newOnRamp);

    /**
     * @dev Thrown when there is no liquidity-token balance available to swap.
     * @dev Selector: 0xa80f0106
     */
    error ZeroAmountToSwap();

    /**
     * @dev Thrown when the on-hand liquidity-token balance does not correspond to the asset amount
     *      of the current subscription (e.g. pre-existing or donated liquidity sitting on the
     *      provider). The swap is bound to the current subscription by comparing the asset amount
     *      the on-ramp expects with the asset amount derived from the provider's on-hand balance;
     *      a mismatch means extra balance would otherwise be swept into the caller's purchase.
     * @param expectedAssetAmount Asset amount (before fee) the on-ramp expects for this subscription.
     * @param actualAssetAmount Asset amount derived from the provider's on-hand liquidity balance.
     * @dev Selector: 0x5be1b6e0
     */
    error UnexpectedLiquidityBalanceError(uint256 expectedAssetAmount, uint256 actualAssetAmount);

    /**
     * @dev Thrown when Grove Basin cannot satisfy the requested asset output.
     * @param requested Asset amount requested from Grove Basin.
     * @param available Asset amount available at the Grove Basin asset custodian.
     * @dev Selector: 0x48b12e37
     */
    error InsufficientAssetLiquidity(uint256 requested, uint256 available);

    /**
     * @dev Thrown when the exact-output swap does not consume the whole on-hand liquidity balance,
     *      which would leave a residual treasury on the provider. The provider must hold no
     *      liquidity-token treasury, so the operation reverts (and rolls back) instead.
     * @param leftover Liquidity-token amount left unspent after the swap.
     * @dev Selector: 0xb2eee4b8
     */
    error LiquidityNotFullyConsumed(uint256 leftover);

    /**
     * @notice Proxy initializer.
     * @param _liquidityToken Liquidity token (stablecoin) supplied by the investor.
     * @param _asset Asset (DSToken) delivered to the investor.
     * @param _navProvider Securitize NAV provider (must match the on-ramp's NAV provider).
     * @param _groveBasin Grove Basin (PSM3) contract used to perform the swap.
     */
    function initialize(address _liquidityToken, address _asset, address _navProvider, address _groveBasin) external;

    /**
     * @notice Sets the on-ramp contract authorized to request assets.
     * @dev Set after deployment to break the deploy-time circular dependency: the on-ramp is
     *      initialized with `custodianWallet == address(this)`, so the provider must exist first.
     * @param _securitizeOnRamp New authorized on-ramp address.
     */
    function setSecuritizeOnRamp(address _securitizeOnRamp) external;

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
     * @notice Returns the asset amount available for purchases in Grove Basin.
     * @return The asset amount available at the Grove Basin asset custodian.
     */
    function availableAsset() external view returns (uint256);
}
