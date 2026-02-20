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
     * @param _assetAmount The amount of asset tokens to redeem
     * @param _minOutputAmount Minimum amount of liquidity tokens to receive
     * @param _investorWallet Address of the investor's wallet (asset holder)
     * @param _investorSignature Signature of the investor
     * @param _marketStatus Current market status (0 = closed, 1 = open)
     * @param _navPrice Current NAV price (1e18 fixed-point)
     * @param _anchorPriceExpiresAt Timestamp when the anchor price expires
     * @param _deadline Timestamp after which the signature is no longer valid.
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 _marketStatus,
        uint256 _navPrice,
        uint256 _anchorPriceExpiresAt,
        uint256 _deadline
    ) external;

    /**
     * @notice Calculates the amount of liquidity tokens that would be received for a given amount of asset tokens
     * @dev Uses the AMM NAV provider to get the execution price and calculates the token conversion
     * @param _assetAmount The amount of asset tokens to be converted
     * @param _anchorPrice The anchor price used for price calculation (1e18 fixed-point)
     * @param _marketStatus Current market status (0 = closed, 1 = open)
     * @return liquidityAmount The amount of liquidity tokens that would be received
     * @return rate The execution price used for the conversion (token decimal fixed-point)
     * @return fee The fee amount in liquidity tokens
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount,
        uint256 _anchorPrice,
        uint8 _marketStatus
    ) external view returns (uint256 liquidityAmount, uint256 rate, uint256 fee);
}
