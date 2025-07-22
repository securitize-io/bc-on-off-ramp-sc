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

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ILiquidityProvider} from "../provider/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";

contract MockExternalRedemption {
    ERC20 public asset;
    ERC20 private liquidityToken;
    ILiquidityProvider public liquidityProvider;
    uint256 public constant FEE_DENOMINATOR = 100_000;
    uint256 public fee;
    uint8 public liquidityDecimals;
    uint8 public assetDecimals;
    ISecuritizeNavProvider public navProvider;

    constructor(address _mockAsset, address _liquidityToken, uint256 _fee, address _navProvider) {
        asset = ERC20(_mockAsset);
        liquidityToken = ERC20(_liquidityToken);
        fee = _fee;
        liquidityDecimals = ERC20(_liquidityToken).decimals();
        assetDecimals = ERC20(_mockAsset).decimals();
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    function _getFee(uint256 amount) private view returns (uint256) {
        if (fee == 0) return 0;
        return (amount * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
    }

    // rate 1:2
    function redeem(uint256 assetAmount, uint256) external {
        ERC20(asset).transferFrom(msg.sender, address(this), assetAmount);

        uint256 liquidityAmount = _convertDecimals(assetAmount, assetDecimals, liquidityDecimals);
        uint256 fee_ = _getFee(liquidityAmount);
        uint256 netLiquidityAmount = (liquidityAmount - fee_) * 2;
        ERC20(liquidityToken).transfer(msg.sender, netLiquidityAmount);
    }

    function updateLiquidityProvider(address _liquidityProvider) external {
        liquidityProvider = ILiquidityProvider(_liquidityProvider);
    }

    function calculateLiquidityTokenAmount(uint256 assetAmount) external view returns (uint256) {
        uint256 liquidityAmount = _convertDecimals(assetAmount, assetDecimals, liquidityDecimals);
        uint256 fee_ = _getFee(liquidityAmount);
        uint256 netLiquidityAmount = (liquidityAmount - fee_) * 2;

        return netLiquidityAmount;
    }

    function calculateLiquidityTokenAmountBeforeFee(uint256 assetAmount) external view returns (uint256) {
        uint256 liquidityAmount = _convertDecimals(assetAmount, assetDecimals, liquidityDecimals);
        return liquidityAmount * 2;
    }

    function availableLiquidity() external view returns (uint256) {
        return liquidityToken.balanceOf(address(this));
    }

    function _convertDecimals(uint256 value, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (fromDecimals == toDecimals) {
            return value;
        } else if (fromDecimals > toDecimals) {
            return value / (10 ** (fromDecimals - toDecimals));
        } else {
            return value * (10 ** (toDecimals - fromDecimals));
        }
    }
}
