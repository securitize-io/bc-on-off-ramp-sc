/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISecuritizeOffRampErrors} from "./ISecuritizeOffRampErrors.sol";

/**
 * @title RedemptionValidator
 * @dev Internal library for redemption validations (gas-optimized)
 */
library RedemptionValidator {
    /**
     * @dev Validates basic redemption requirements
     * @param _redeemer Address of the redeemer
     * @param _assetAmount Amount to redeem
     * @param _asset Asset token contract

     */
    function validateRedemption(address _redeemer, uint256 _assetAmount, IERC20 _asset) internal view {
        // Validate redeemer balance
        if (_asset.balanceOf(_redeemer) < _assetAmount) {
            revert ISecuritizeOffRampErrors.InsufficientRedeemerBalance(
                _redeemer,
                _assetAmount,
                _asset.balanceOf(_redeemer)
            );
        }
    }
}
