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

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IGroveBasin} from "../third-party-contracts/IGroveBasin.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
/**
 * @title  MockGroveBasin
 * @notice Minimal GroveBasin mock for external integration tests.
 * @dev    `previewSwapExactIn` quotes via a configurable exchange rate and fee.
 *         `swapExactIn` mirrors real Basin asset flows:
 *           - `_pullAsset`  → transferFrom(msg.sender, custodian, amountIn)
 *           - `_pushAsset`  → transferFrom(pocket, receiver) for swapToken when an
 *                             external pocket is set, otherwise transfer(receiver)
 */
contract MockGroveBasin {

    using SafeERC20 for IERC20;

    /// @dev Token whose inbound/outbound custody can be delegated to `pocket`.
    address public swapToken;

    /// @dev External pocket for swapToken custody. Defaults to `address(this)`.
    address public pocket;

    constructor(address swapToken_) {
        swapToken = swapToken_;
        pocket    = address(this);
    }

    function setSwapToken(address newSwapToken) external {
        swapToken = newSwapToken;
    }

    function setPocket(address newPocket) external {
        pocket = newPocket == address(0) ? address(this) : newPocket;
    }

    /**
     * @notice Previews the amount of `assetOut` received for an exact input swap.
     * @dev The conversion rate between `assetIn` and `assetOut` is fixed at 1:1.
     *      No pricing, fees, slippage, or exchange rate calculations are applied.
     *      The returned amount is adjusted only to account for differences in the
     *      decimal precision of the two tokens.
     *
     *      Formula:
     *      amountOut = amountIn * 10^assetOut.decimals() / 10^assetIn.decimals()
     *
     * @param assetIn The token being provided as input.
     * @param assetOut The token being received as output.
     * @param amountIn The amount of `assetIn` to swap.
     *
     * @return amountOut The equivalent amount of `assetOut` at a 1:1 conversion rate,
     *                   normalized to the decimal precision of `assetOut`.
     */
    function previewSwapExactIn(address assetIn, address assetOut, uint256 amountIn)
    public
    view
    returns (uint256 amountOut)
    {
        uint256 precisionIn  = 10 ** ERC20(assetIn).decimals();
        uint256 precisionOut = 10 ** ERC20(assetOut).decimals();
        amountOut = Math.mulDiv(
            amountIn,
            precisionOut,
            precisionIn
        );
    }

    function swapExactIn(
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 ,
        address receiver,
        uint256 referralCode
    )
    external
    returns (uint256 amountOut)
    {
        if (amountIn == 0)          revert IGroveBasin.ZeroAmountIn();
        if (receiver == address(0)) revert IGroveBasin.ZeroReceiver();

        amountOut = previewSwapExactIn(assetIn, assetOut, amountIn);
        _pullAsset(assetIn, amountIn);
        _pushAsset(assetOut, receiver, amountOut);

        emit IGroveBasin.Swap(assetIn, assetOut, msg.sender, receiver, amountIn, amountOut, referralCode);
    }

    function _getAssetCustodian(address asset) internal view returns (address custodian) {
        custodian = asset == swapToken && _hasPocket() ? pocket : address(this);
    }

    function _hasPocket() internal view returns (bool) {
        return pocket != address(this);
    }

    function _pullAsset(address asset, uint256 amount) internal {
        IERC20(asset).safeTransferFrom(msg.sender, _getAssetCustodian(asset), amount);
    }

    function _pushAsset(address asset, address receiver, uint256 amount) internal {
        if (asset == swapToken && _hasPocket()) {
            IERC20(asset).safeTransferFrom(pocket, receiver, amount);
        } else {
            IERC20(asset).safeTransfer(receiver, amount);
        }
    }
}
