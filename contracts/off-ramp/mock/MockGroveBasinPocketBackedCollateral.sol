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
 * @title  MockGroveBasinPocketBackedCollateral
 * @notice Grove Basin mock that reproduces the collateral pocket top-up path exercised by the real
 *         {GroveBasin._withdrawLiquidityInPocket} collateral branch.
 * @dev    Custody of the `collateralToken` is the Basin contract itself, mirroring the real Grove
 *         Basin (the pocket only custodies the `swapToken`). But when a `collateralToken` output
 *         exceeds the Basin-side balance, Grove Basin pulls the deficit from its configured pocket
 *         (e.g. `UsdsUsdcPocket` converting USDS -> USDC via the PSM) before pushing the output to
 *         the receiver. This mock models exactly that: it holds a low direct collateral balance yet
 *         can satisfy a larger output by pulling the deficit from {collateralLiquiditySource}.
 *
 *         `getLiquidityCustodian()` on the provider resolves to THIS contract (collateral custody),
 *         so `availableLiquidity()` reports only the direct Basin-side balance and understates the
 *         deliverable amount. This mock is used to prove that the provider no longer applies a local
 *         balance-based gate and instead delegates the hard liquidity guarantee to Grove Basin.
 */
contract MockGroveBasinPocketBackedCollateral {
    using SafeERC20 for IERC20;

    /// @dev Basis points denominator matching Grove Basin (10_000 = 100%).
    uint256 public constant BPS = 10_000;

    /// @dev Collateral token delivered during credit-to-collateral redemptions (e.g. USDC).
    address public collateralToken;

    /// @dev Credit token swapped into Grove Basin during redemption (e.g. RWA / DSToken).
    address public creditToken;

    /// @dev Swap token whose custody can be delegated to the pocket. Unused in this integration.
    address public swapToken;

    /// @dev Pocket reported for config validation and `swapToken` custody. Non-zero by construction.
    address public pocket;

    /// @dev Source that backs the collateral deficit (mimics the pocket / PSM top-up). It must hold
    ///      collateral tokens and have approved this contract to pull them.
    address public collateralLiquiditySource;

    /// @dev True once `swapExactIn` has executed at least once. Used to assert the swap was reached.
    bool public swapCalled;

    /// @dev Deficit pulled from {collateralLiquiditySource} on the last `swapExactIn` call.
    uint256 public lastPocketTopUp;

    constructor(address collateralToken_, address creditToken_) {
        collateralToken = collateralToken_;
        creditToken = creditToken_;
        pocket = address(this);
    }

    function setCollateralLiquiditySource(address source) external {
        collateralLiquiditySource = source;
    }

    /**
     * @notice Previews the amount of `assetOut` received for an exact input swap (decimal-adjusted 1:1).
     * @param assetIn The token being provided as input.
     * @param assetOut The token being received as output.
     * @param amountIn The amount of `assetIn` to swap.
     * @return amountOut The quoted amount of `assetOut`.
     */
    function previewSwapExactIn(
        address assetIn,
        address assetOut,
        uint256 amountIn
    ) public view returns (uint256 amountOut) {
        uint256 precisionIn = 10 ** ERC20(assetIn).decimals();
        uint256 precisionOut = 10 ** ERC20(assetOut).decimals();
        amountOut = Math.mulDiv(amountIn, precisionOut, precisionIn);
    }

    /**
     * @notice Swaps exactly `amountIn` of `assetIn` for `assetOut`, topping up the collateral deficit
     *         from {collateralLiquiditySource} when the direct balance is insufficient.
     * @dev Reverts with {IGroveBasin.InsufficientFunds} when neither the Basin balance nor the
     *      configured source can deliver the requested output, mirroring the real hard guarantee.
     */
    function swapExactIn(
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        uint256 referralCode
    ) external returns (uint256 amountOut) {
        if (amountIn == 0) revert IGroveBasin.ZeroAmountIn();
        if (receiver == address(0)) revert IGroveBasin.ZeroReceiver();

        amountOut = previewSwapExactIn(assetIn, assetOut, amountIn);
        if (amountOut < minAmountOut) revert IGroveBasin.AmountOutTooLow();

        // Pull the input asset in (creditToken custody is the Basin contract itself).
        IERC20(assetIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Collateral output: top up the deficit from the pocket-equivalent source before pushing.
        lastPocketTopUp = 0;
        if (assetOut == collateralToken) {
            uint256 basinBalance = IERC20(assetOut).balanceOf(address(this));
            if (basinBalance < amountOut) {
                uint256 deficit = amountOut - basinBalance;
                uint256 sourceBalance = IERC20(assetOut).balanceOf(collateralLiquiditySource);
                if (sourceBalance < deficit) revert IGroveBasin.InsufficientFunds();

                IERC20(assetOut).safeTransferFrom(collateralLiquiditySource, address(this), deficit);
                lastPocketTopUp = deficit;
            }
        }

        IERC20(assetOut).safeTransfer(receiver, amountOut);
        swapCalled = true;

        emit IGroveBasin.Swap(assetIn, assetOut, msg.sender, receiver, amountIn, amountOut, referralCode);
    }
}
