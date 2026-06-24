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
 * @dev    `previewSwapExactIn` quotes via a configurable exchange rate and redemption fee.
 *         `swapExactIn` mirrors real Basin asset flows:
 *           - `_pullAsset`  → transferFrom(msg.sender, custodian, amountIn)
 *           - `_pushAsset`  → transferFrom(pocket, receiver) for swapToken when an external
 *                             pocket is set, otherwise transfer(receiver)
 *
 *         Custody mirrors the real Grove Basin: the `pocket` only custodies the `swapToken`,
 *         while the `collateralToken` and `creditToken` are held by this contract.
 */
contract MockGroveBasin {
    using SafeERC20 for IERC20;

    /// @dev Basis points denominator matching Grove Basin (10_000 = 100%).
    uint256 public constant BPS = 10_000;

    /// @dev Collateral token delivered during credit-to-collateral redemptions (e.g. USDC).
    address public collateralToken;

    /// @dev Credit token swapped into Grove Basin during redemption (e.g. RWA / DSToken).
    address public creditToken;

    /// @dev Swap token whose custody can be delegated to the pocket. Defaults to the zero address
    ///      because this integration does not use the swap token path.
    address public swapToken;

    /// @dev External pocket for swapToken custody. Defaults to `address(this)`.
    address public pocket;

    /// @dev Numerator of the preview rate factor applied on top of the decimal-adjusted 1:1 quote.
    uint256 public previewNumerator;

    /// @dev Denominator of the preview rate factor applied on top of the decimal-adjusted 1:1 quote.
    uint256 public previewDenominator;

    /// @dev Redemption fee in BPS deducted from the preview output (rounds up).
    uint256 public redemptionFeeBps;

    /// @dev Numerator of the execution slippage factor applied on top of the preview quote.
    uint256 public outputNumerator;

    /// @dev Denominator of the execution slippage factor applied on top of the preview quote.
    uint256 public outputDenominator;

    constructor(address collateralToken_) {
        collateralToken = collateralToken_;
        pocket = address(this);
        previewNumerator = 1;
        previewDenominator = 1;
        outputNumerator = 1;
        outputDenominator = 1;
    }

    function setCollateralToken(address newCollateralToken) external {
        collateralToken = newCollateralToken;
    }

    function setCreditToken(address newCreditToken) external {
        creditToken = newCreditToken;
    }

    function setSwapToken(address newSwapToken) external {
        swapToken = newSwapToken;
    }

    function setPocket(address newPocket) external {
        pocket = newPocket == address(0) ? address(this) : newPocket;
    }

    /**
     * @notice Configures a rate factor applied in `previewSwapExactIn` on top of the 1:1 quote.
     * @param numerator Preview rate numerator.
     * @param denominator Preview rate denominator (must be non-zero).
     */
    function setPreviewFactor(uint256 numerator, uint256 denominator) external {
        require(denominator != 0, "denominator=0");
        previewNumerator = numerator;
        previewDenominator = denominator;
    }

    /**
     * @notice Configures the redemption fee in BPS deducted from the preview output.
     * @param feeBps Redemption fee in basis points (10 = 0.1%).
     */
    function setRedemptionFeeBps(uint256 feeBps) external {
        redemptionFeeBps = feeBps;
    }

    /**
     * @notice Configures an execution slippage factor applied on top of the preview quote in `swapExactIn`.
     * @param numerator Output deviation numerator.
     * @param denominator Output deviation denominator (must be non-zero).
     */
    function setOutputFactor(uint256 numerator, uint256 denominator) external {
        require(denominator != 0, "denominator=0");
        outputNumerator = numerator;
        outputDenominator = denominator;
    }

    /**
     * @notice Previews the amount of `assetOut` received for an exact input swap.
     * @param assetIn The token being provided as input.
     * @param assetOut The token being received as output.
     * @param amountIn The amount of `assetIn` to swap.
     * @return amountOut The quoted amount of `assetOut` after rate factor and redemption fee.
     */
    function previewSwapExactIn(address assetIn, address assetOut, uint256 amountIn)
        public
        view
        returns (uint256 amountOut)
    {
        return _quotePreview(assetIn, assetOut, amountIn);
    }

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

        uint256 quoted = _quotePreview(assetIn, assetOut, amountIn);
        amountOut = Math.mulDiv(quoted, outputNumerator, outputDenominator);

        if (amountOut < minAmountOut) revert IGroveBasin.AmountOutTooLow();

        _pullAsset(assetIn, amountIn);
        _pushAsset(assetOut, receiver, amountOut);

        emit IGroveBasin.Swap(assetIn, assetOut, msg.sender, receiver, amountIn, amountOut, referralCode);
    }

    function _quotePreview(address assetIn, address assetOut, uint256 amountIn) internal view returns (uint256 amountOut) {
        uint256 precisionIn = 10 ** ERC20(assetIn).decimals();
        uint256 precisionOut = 10 ** ERC20(assetOut).decimals();
        amountOut = Math.mulDiv(amountIn, precisionOut, precisionIn);
        amountOut = Math.mulDiv(amountOut, previewNumerator, previewDenominator);

        if (redemptionFeeBps > 0) {
            uint256 fee = Math.mulDiv(amountOut, redemptionFeeBps, BPS, Math.Rounding.Ceil);
            amountOut -= fee;
        }
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
