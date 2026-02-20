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

    /**
     * @dev Mock constructor initializing tokens, fee, and NAV provider.
     * @param _mockAsset Mock asset token address.
     * @param _liquidityToken Liquidity token address.
     * @param _fee Fee in FEE_DENOMINATOR terms.
     * @param _navProvider NAV provider address.
     */
    constructor(address _mockAsset, address _liquidityToken, uint256 _fee, address _navProvider) {
        asset = ERC20(_mockAsset);
        liquidityToken = ERC20(_liquidityToken);
        fee = _fee;
        liquidityDecimals = ERC20(_liquidityToken).decimals();
        assetDecimals = ERC20(_mockAsset).decimals();
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @dev Computes fee for a given amount using configured fee rate.
     * @param _amount Amount to charge fee on.
     * @return Fee amount.
     */
    function _getFee(uint256 _amount) private view returns (uint256) {
        if (fee == 0) return 0;
        return (_amount * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
    }

    /**
     * @dev Redeem mock asset for liquidity token (rate 1:2) applying fee.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity expected (unused in mock).
     */
    function redeem(uint256 _assetAmount, uint256 _minOutputAmount) external {
        _minOutputAmount;

        ERC20(asset).transferFrom(msg.sender, address(this), _assetAmount);

        uint256 liquidityAmount = _convertDecimals(_assetAmount, assetDecimals, liquidityDecimals);
        uint256 fee_ = _getFee(liquidityAmount);
        uint256 netLiquidityAmount = (liquidityAmount - fee_) * 2;
        ERC20(liquidityToken).transfer(msg.sender, netLiquidityAmount);
    }

    /**
     * @dev Updates the associated liquidity provider.
     * @param _liquidityProvider Liquidity provider address.
     */
    function updateLiquidityProvider(address _liquidityProvider) external {
        liquidityProvider = ILiquidityProvider(_liquidityProvider);
    }

    /**
     * @dev Calculates expected liquidity token output (rate 1:2) after fee.
     * @param _assetAmount Asset amount to redeem.
     */
    function calculateLiquidityTokenAmount(uint256 _assetAmount) external view returns (uint256) {
        uint256 liquidityAmount = _convertDecimals(_assetAmount, assetDecimals, liquidityDecimals);
        uint256 fee_ = _getFee(liquidityAmount);
        uint256 netLiquidityAmount = (liquidityAmount - fee_) * 2;

        return netLiquidityAmount;
    }

    /**
     * @dev Calculates liquidity token output (rate 1:2) before fee.
     * @param _assetAmount Asset amount to redeem.
     */
    function calculateLiquidityTokenAmountBeforeFee(uint256 _assetAmount) external view returns (uint256) {
        uint256 liquidityAmount = _convertDecimals(_assetAmount, assetDecimals, liquidityDecimals);
        return liquidityAmount * 2;
    }

    function availableLiquidity() external view returns (uint256) {
        return liquidityToken.balanceOf(address(this));
    }

    /**
     * @dev Normalizes value between differing decimals.
     * @param _value Amount to convert.
     * @param _fromDecimals Decimals of input amount.
     * @param _toDecimals Target decimals.
     * @return Converted amount with target decimals.
     */
    function _convertDecimals(uint256 _value, uint8 _fromDecimals, uint8 _toDecimals) internal pure returns (uint256) {
        if (_fromDecimals == _toDecimals) {
            return _value;
        } else if (_fromDecimals > _toDecimals) {
            return _value / (10 ** (_fromDecimals - _toDecimals));
        } else {
            return _value * (10 ** (_toDecimals - _fromDecimals));
        }
    }
}
