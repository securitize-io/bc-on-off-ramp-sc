/**
 * Copyright 2025 Securitize Inc. All rights reserved.
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

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IOnOffRamp} from "../common/IOnOffRamp.sol";
import {ISecuritizeOffRampErrors} from "./ISecuritizeOffRampErrors.sol";

/**
 * @title ISecuritizeOffRamp
 */
interface ISecuritizeOffRamp is IOnOffRamp, ISecuritizeOffRampErrors {
    function initialize(address _asset, address _navProvider, address _feeManager, bool _assetBurn) external;

    /**
     * @dev Update the liquidity provider
     * @param _liquidityProvider The new liquidity provider address
     */
    function updateLiquidityProvider(address _liquidityProvider) external;

    /**
     * @dev Redeems an amount of asset for liquidity
     * @param amount The amount of the asset token to redeem
     * @param minOutputAmount The minimum amount of liquidity tokens that must be received (slippage protection)
     */
    function redeem(uint256 amount, uint256 minOutputAmount) external;

    /**
     * @dev Update the NAV rate provider
     * @param _navProvider The NAV rate provider address
     */
    function updateNavProvider(address _navProvider) external;

    /**
     * @dev The asset being redeemed.
     * @return The address of the asset token.
     */
    function asset() external view returns (IDSToken);

    /**
     * @dev The address of the asset being redeemed.
     * @return The address of the asset token.
     */
    function assetAddress() external view returns (address);

    /**
     * @dev The current liquidity provider.
     * @return The address of the liquidity provider.
     */
    function liquidityProvider() external view returns (ILiquidityProvider);

    /**
     * @dev The current NAV rate provider address
     * @return The address of the NAV rate provider.
     */
    function navProvider() external view returns (ISecuritizeNavProvider);

    /**
     * @dev Calculates the amount of liquidity tokens to receive in redemption process
     * @param _amount The amount of asset tokens to redeem.
     * @return The amount of liquidity tokens.
     */
    function normalizeAmountByDecimals(uint256 _amount) external view returns (uint256);

    /**
     * @dev Calculates the amount of liquidity tokens to receive in redemption process
     * @param _amount The amount of asset tokens to redeem.
     * @return The amount of liquidity tokens.
     */
    function calculateLiquidityTokenAmount(uint256 _amount) external view returns (uint256);

    /**
     * @dev The available liquidity that can be supplied
     * @return The available liquidity amount
     */
    function availableLiquidity() external view returns (uint256);
}
