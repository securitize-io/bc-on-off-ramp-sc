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

import {IBaseOffRamp} from "./IBaseOffRamp.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";

/**
 * @title IThirdPartyOffRamp
 * @notice Operator-gated off-ramp that redeems an asset for a liquidity token through a
 *         Grove Basin liquidity provider using an atomic 1:1 swap.
 */
interface IThirdPartyOffRamp is IBaseOffRamp {
    /**
     * @dev Emitted when an operator-triggered Grove Basin redemption completes.
     * @param investor Wallet whose asset was redeemed and that received the liquidity token.
     * @param assetAmountIn Amount of asset redeemed (swapped into Grove Basin).
     * @param liquidityAmountOut Amount of liquidity token delivered to the investor (after fee).
     * @param operator Operator wallet that triggered the redemption.
     */
    event GroveBasinRedemption(
        address indexed investor,
        uint256 assetAmountIn,
        uint256 liquidityAmountOut,
        address indexed operator
    );

    /**
     * @dev Thrown when redemption is attempted while two-step transfer is disabled.
     */
    error OneStepRedemptionNotSupportedError();

    /**
     * @dev Thrown when initialization is attempted with asset burn enabled.
     */
    error AssetBurnNotSupportedError();

    /**
     * @notice Redeems an investor's asset for the liquidity token via Grove Basin.
     * @param _assetAmount Amount of asset to redeem.
     * @param _minOutputAmount Minimum amount of liquidity token the investor must receive.
     * @param _investorWallet Wallet that owns the asset and receives the liquidity token.
     */
    function redeem(uint256 _assetAmount, uint256 _minOutputAmount, address _investorWallet) external;

    /**
     * @notice Calculates the amount of liquidity token received for a given asset amount (after fees).
     * @param _assetAmount Amount of asset to redeem.
     * @return The amount of liquidity token that will be received after fees.
     */
    function calculateLiquidityTokenAmount(uint256 _assetAmount) external view returns (uint256);

    /**
     * @notice Calculates the amount of liquidity token for a given asset amount before fees.
     * @param _assetAmount Amount of asset to redeem.
     * @return The amount of liquidity token before fees.
     */
    function calculateLiquidityTokenAmountBeforeFee(uint256 _assetAmount) external view returns (uint256);

    /**
     * @notice The current NAV rate provider.
     * @return The NAV rate provider address.
     */
    function navProvider() external view returns (ISecuritizeNavProvider);
}
