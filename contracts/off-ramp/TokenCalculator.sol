/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IFeeManager} from "../fee/IFeeManager.sol";
import {Errors} from "../common/Errors.sol";

/**
 * @title TokenCalculator
 * @dev Handles token amount calculations and fee computations
 */
library TokenCalculator {
    /**
     * @dev Calculates the amount of liquidity tokens without fees
     * @param assetAmount The amount of asset tokens to redeem
     * @param rate The current NAV rate
     * @param liquidityDecimals Decimals of the liquidity token
     * @param assetDecimals Decimals of the asset token
     * @return The amount of liquidity tokens without fees
     */
    function calculateLiquidityTokenAmountWithoutFee(
        uint256 assetAmount,
        uint256 rate,
        uint256 liquidityDecimals,
        uint256 assetDecimals
    ) internal pure returns (uint256) {
        if (liquidityDecimals > assetDecimals) {
            return ((assetAmount * rate) * (10 ** (liquidityDecimals - assetDecimals))) / (10 ** liquidityDecimals);
        }
        if (liquidityDecimals < assetDecimals) {
            return (assetAmount * rate) / (10 ** (assetDecimals - liquidityDecimals)) / (10 ** liquidityDecimals);
        }
        return (assetAmount * rate) / (10 ** assetDecimals);
    }

    /**
     * @dev Calculates the amount of liquidity tokens after applying fees
     * @param assetAmount The amount of asset tokens to redeem
     * @param rate The current NAV rate
     * @param liquidityDecimals Decimals of the liquidity token
     * @param assetDecimals Decimals of the asset token
     * @param feeManager Address of the fee manager
     * @return The amount of liquidity tokens after fees
     */
    function calculateLiquidityTokenAmountWithFee(
        uint256 assetAmount,
        uint256 rate,
        uint256 liquidityDecimals,
        uint256 assetDecimals,
        address feeManager
    ) internal view returns (uint256) {
        uint256 liquidityTokenAmount = calculateLiquidityTokenAmountWithoutFee(
            assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 fee = calculateFee(feeManager, liquidityTokenAmount);
        return liquidityTokenAmount - fee;
    }

    /**
     * @dev Calculates the fee amount for a given amount
     * @param feeManager Address of the fee manager
     * @param amount The amount to calculate fee for
     * @return The fee amount
     */
    function calculateFee(address feeManager, uint256 amount) internal view returns (uint256) {
        IFeeManager feeManagerInstance = IFeeManager(feeManager);
        return feeManagerInstance.getFee(amount);
    }
}
