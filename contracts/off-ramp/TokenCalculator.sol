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
 */
library TokenCalculator {
    /**
     * @dev Normalizes an amount by its decimals and rate
     * @param amount The raw token amount to normalize
     * @param rate The conversion rate
     * @param decimals The number of decimals for the token
     * @return The normalized token amount
     */
    function calculateLiquidityTokenAmountBeforeFee(
        uint256 amount,
        uint256 rate,
        uint256 decimals
    ) internal pure returns (uint256) {
        return (amount * rate) / (10 ** decimals);
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
