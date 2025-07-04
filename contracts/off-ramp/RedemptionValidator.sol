/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {ISecuritizeOffRampErrors} from "./ISecuritizeOffRampErrors.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {Errors} from "../common/Errors.sol";

/**
 * @title RedemptionValidator
 * @dev Internal library for redemption validations (gas-optimized)
 */
library RedemptionValidator {
    /**
     * @dev Validates basic redemption requirements
     * @param redeemer Address of the redeemer
     * @param assetAmount Amount to redeem
     * @param asset Asset token contract

     */
    function validateRedemption(address redeemer, uint256 assetAmount, IERC20 asset) internal view {
        // Validate redeemer balance
        if (asset.balanceOf(redeemer) < assetAmount) {
            revert ISecuritizeOffRampErrors.InsufficientRedeemerBalance(
                redeemer,
                assetAmount,
                asset.balanceOf(redeemer)
            );
        }
    }
}
