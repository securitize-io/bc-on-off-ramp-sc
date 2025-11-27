/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IFeeManager} from "../fee/IFeeManager.sol";

/**
 * @title TokenCalculator
 * @dev Handles token amount calculations and fee computations
 *
 * @notice Overflow Protection:
 * This contract relies on Solidity 0.8.22's built-in overflow/underflow protection.
 * Calculations will revert (not wrap) if intermediate values exceed uint256 max.
 *
 * For extremely large values (assetAmount * rate * 10^decimals > 2^256):
 * - Transaction will revert with panic code 0x11 (arithmetic overflow)
 * - This is intentional to prevent incorrect calculations
 * - Consider breaking large redemptions into smaller batches if needed
 */
library TokenCalculator {
    /**
     * @dev Normalizes an amount by its decimals and rate
     * @param _assetAmount The amount of the asset
     * @param _rate The conversion rate
     * @param _liquidityDecimals The decimals of the liquidity token
     * @param _assetDecimals The decimals of the asset token
     * @return The normalized token amount
     */
    function calculateLiquidityTokenAmountBeforeFee(
        uint256 _assetAmount,
        uint256 _rate,
        uint256 _liquidityDecimals,
        uint256 _assetDecimals
    ) internal pure returns (uint256) {
        return (_assetAmount * _rate * 10 ** _liquidityDecimals) / (10 ** _assetDecimals * 10 ** _assetDecimals);
    }

    /**
     * @dev Calculates the fee amount for a given amount
     * @param _feeManager Address of the fee manager
     * @param _amount The amount to calculate fee for
     * @return The fee amount
     */
    function calculateFee(address _feeManager, uint256 _amount) internal view returns (uint256) {
        IFeeManager feeManagerInstance = IFeeManager(_feeManager);
        return feeManagerInstance.getFee(_amount);
    }
}
