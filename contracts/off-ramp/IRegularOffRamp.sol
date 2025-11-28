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

import {IBaseOffRamp} from "./IBaseOffRamp.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";

interface IRegularOffRamp is IBaseOffRamp {

    /**
     * @dev Redeems asset tokens for liquidity tokens using on-chain NAV rate
     * @param _assetAmount The amount of asset tokens to redeem
     * @param _minOutputAmount The minimum amount of liquidity tokens that must be received (slippage protection)
     */
    function redeem(uint256 _assetAmount, uint256 _minOutputAmount) external;

    /**
     * @dev Calculates the amount of liquidity tokens to be received for a given asset amount
     * @param _assetAmount The amount of asset tokens to redeem
     * @return The amount of liquidity tokens that will be received (after fees)
     */
    function calculateLiquidityTokenAmount(uint256 _assetAmount) external view returns (uint256);

    /**
     * @dev Calculates the amount of liquidity tokens to receive in redemption process before fees
     * @param _assetAmount The amount of asset tokens to redeem.
     * @return The amount of liquidity tokens.
     */
    function calculateLiquidityTokenAmountBeforeFee(uint256 _assetAmount) external view returns (uint256);

    /**
     * @dev The current NAV rate provider address
     * @return The address of the NAV rate provider.
     */
    function navProvider() external view returns (ISecuritizeNavProvider);
}
