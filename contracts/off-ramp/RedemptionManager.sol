/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {Errors} from "../common/Errors.sol";

/**
 * @title RedemptionManager
 * @dev Handles the core redemption logic for both single-step and two-step transfers
 */
library RedemptionManager {
    struct RedemptionParams {
        IDSToken asset;
        ILiquidityProvider liquidityProvider;
        address feeManager;
        uint256 assetAmount;
        uint256 liquidityTokenAmount;
        uint256 minOutputAmount;
        address redeemer;
        bool assetBurn;
    }

    /**
     * @dev Executes single-step redemption
     */
    function executeSingleStepRedemption(
        RedemptionParams memory params
    ) internal returns (uint256 fee, uint256 suppliedAmount) {
        // Transfer asset to liquidity provider
        if (params.assetBurn) {
            params.asset.burn(params.redeemer, params.assetAmount, "Redemption burn");
        } else {
            params.asset.transferFrom(params.redeemer, params.liquidityProvider.recipient(), params.assetAmount);
        }

        // Apply fee if it exists, transfer it to the fee collector
        fee = TokenCalculator.calculateFee(params.feeManager, params.liquidityTokenAmount);

        // Supply liquidity tokens to the fee collector
        if (fee > 0) {
            params.liquidityProvider.supplyTo(IFeeManager(params.feeManager).feeCollector(), fee, 0);
        }

        // Supply liquidity tokens to the redeemer
        suppliedAmount = params.liquidityProvider.supplyTo(
            params.redeemer,
            params.liquidityTokenAmount - fee,
            params.minOutputAmount
        );

        if (suppliedAmount < params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }
    }

    /**
     * @dev Executes two-step redemption
     */
    function executeTwoStepRedemption(
        RedemptionParams memory params,
        address contractAddress
    ) internal returns (uint256 fee, uint256 userSuppliedAmount) {
        // Get DS tokens from investor to contract
        params.asset.transferFrom(params.redeemer, contractAddress, params.assetAmount);

        // Transfer DS tokens from contract to recipient or burn
        if (params.assetBurn) {
            params.asset.burn(contractAddress, params.assetAmount, "Redemption burn");
        } else {
            params.asset.transfer(params.liquidityProvider.recipient(), params.assetAmount);
        }

        // Get liquidity from provider to contract
        uint256 suppliedAmount = params.liquidityProvider.supplyTo(
            contractAddress,
            params.liquidityTokenAmount,
            params.minOutputAmount
        );

        // Calculate fee based on supplied amount
        fee = TokenCalculator.calculateFee(params.feeManager, suppliedAmount);

        userSuppliedAmount = suppliedAmount - fee;
        // Check slippage protection - ensure minimum output amount is met
        if (userSuppliedAmount < params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }

        // Transfer liquidity tokens from contract to redeemer
        params.liquidityProvider.liquidityToken().transfer(params.redeemer, userSuppliedAmount);

        // Transfer fee from contract to fee collector
        if (fee > 0) {
            params.liquidityProvider.liquidityToken().transfer(IFeeManager(params.feeManager).feeCollector(), fee);
        }
    }
}
