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

interface IPublicStockOffRamp is IBaseOffRamp {

    /**
     * @dev Redeems asset tokens for liquidity tokens using an externally provided NAV price and investor authorization
     * @param assetAmount The amount of asset tokens to redeem
     * @param minOutputAmount Minimum amount of liquidity tokens to receive
     * @param investorWallet Address of the investor's wallet (asset holder)
     * @param investorSignature Signature of the investor
     * @param marketStatus Current market status
     * @param navPrice Current NAV price
     */
    function redeem(
        uint256 assetAmount,
        uint256 minOutputAmount,
        address investorWallet,
        bytes memory investorSignature,
        uint8 marketStatus,
        uint256 navPrice
    ) external;

    /**
     * @dev Calculates the amount of liquidity tokens to be received for a given asset amount
     * @param assetAmount Amount of asset tokens to convert
     * @param navRate Current exchange rate
     * @return liquidityTokenAmount Amount of liquidity tokens to be received
     * @return usedRate Current exchange rate used in calculation
     * @return fee Fee amount deducted from the liquidity tokens
     */
    function calculateLiquidityTokenAmount(
        uint256 assetAmount,
        uint256 navRate
    ) external view returns (uint256 liquidityTokenAmount, uint256 usedRate, uint256 fee);
}
