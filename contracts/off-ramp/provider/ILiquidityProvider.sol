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

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";
import {Errors} from "../../common/Errors.sol";

/**
 * @title ILiquidityProvider
 */
interface ILiquidityProvider is Errors {
    /*
     * @dev error selector: 0xa17e11d5
     */
    error InsufficientLiquidity(uint256 requested, uint256 available);

    /**
     * @dev Supplies liquidity to a recipient
     * @param _redeemer Receiver of liquidity
     * @param _amount Amount of liquidity to transfer
     */
    function supplyTo(address _redeemer, uint256 _amount) external returns (uint256 amountToSupply);

    /**
     * @dev Calculates the effective liquidity token amount to supply
     * @param initialLiquidityAmount The initial liquidity amount
     * @return amountToSupply The effective liquidity token amount to supply
     */
    function calculateEffectiveLiquidityTokenAmount(
        uint256 initialLiquidityAmount
    ) external view returns (uint256 amountToSupply);

    /**
     * @dev Returns the liquidity asset.
     * @return liquidity address.
     */
    function liquidityToken() external view returns (IERC20Metadata);

    /**
     * @dev The securitize off ramp contract.
     * @return The address of the securitize off ramp contract.
     */
    function securitizeOffRamp() external view returns (ISecuritizeOffRamp);

    /**
     * @dev Wallet address that receives digital assets.
     * @return Wallet address.
     */
    function recipient() external view returns (address);

    /**
     * @dev The available liquidity that can be supplied
     * @return The available liquidity amount
     */
    function availableLiquidity() external view returns (uint256);
}
