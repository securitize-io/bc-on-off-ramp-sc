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

import {IBaseOnRamp} from "./IBaseOnRamp.sol";

interface IPublicStockOnRamp is IBaseOnRamp {

    /**
     * @dev Swaps liquidity tokens for DS tokens
     * @param _liquidityAmount Amount of liquidity tokens to swap
     * @param _minOutAmount Minimum amount of DS tokens to receive
     * @param _investorWallet Address of the investor's wallet
     * @param _investorSignature Signature of the investor
     * @param _marketStatus Current market status
     * @param _anchorPrice Current NAV price
     */
    function swap(
        uint256 _liquidityAmount,
        uint256 _minOutAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 _marketStatus,
        uint256 _anchorPrice
    ) external;

    /**
     * @dev Calculates the amount of DS tokens to be received for a given amount of liquidity tokens
     * @param _liquidityAmount Amount of liquidity tokens to convert
     * @param _rate Current exchange rate
     * @return dsTokenAmount Amount of DS tokens to be received
     * @return rate Current exchange rate used in calculation
     * @return fee Fee amount deducted from the liquidity tokens
     */
    function calculateDsTokenAmount(uint256 _liquidityAmount, uint256 _rate) external view returns (uint256 dsTokenAmount, uint256 rate, uint256 fee);

}
