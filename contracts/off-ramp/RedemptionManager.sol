/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
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
    function executeSingleStepRedemption(RedemptionParams memory params) internal returns (uint256 fee) {
        // Transfer asset to liquidity provider
        if (params.assetBurn) {
            params.asset.burn(params.redeemer, params.assetAmount, "Redemption burn");
        } else {
            params.asset.transferFrom(params.redeemer, params.liquidityProvider.recipient(), params.assetAmount);
        }

        // Apply fee if it exists, transfer it to the fee collector
        fee = _getFee(params.feeManager, params.liquidityTokenAmount);
        uint256 liquidityTokenAmountAfterFee = params.liquidityTokenAmount - fee;

        // Check slippage protection - ensure minimum output amount is met
        if (liquidityTokenAmountAfterFee < params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }

        // Supply liquidity tokens to the fee collector
        if (fee > 0) {
            params.liquidityProvider.supplyTo(IFeeManager(params.feeManager).feeCollector(), fee, 0);
        }
        // Supply liquidity tokens to the redeemer
        params.liquidityProvider.supplyTo(params.redeemer, liquidityTokenAmountAfterFee, params.minOutputAmount);
    }

    /**
     * @dev Executes two-step redemption
     */
    function executeTwoStepRedemption(
        RedemptionParams memory params,
        address contractAddress
    ) internal returns (uint256 fee) {
        // Get DS tokens from investor to contract
        params.asset.transferFrom(params.redeemer, contractAddress, params.assetAmount);

        // Transfer DS tokens from contract to recipient or burn
        if (params.assetBurn) {
            params.asset.burn(contractAddress, params.assetAmount, "Redemption burn");
        } else {
            params.asset.transfer(params.liquidityProvider.recipient(), params.assetAmount);
        }

        // Get liquidity from provider to contract
        params.liquidityProvider.supplyTo(contractAddress, params.liquidityTokenAmount, params.minOutputAmount);

        // Transfer full liquidity from contract to investor
        uint256 offRampBalance = params.liquidityProvider.liquidityToken().balanceOf(contractAddress);
        fee = _getFee(params.feeManager, offRampBalance);

        // Check slippage protection - ensure minimum output amount is met
        if (offRampBalance - fee < params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }

        params.liquidityProvider.liquidityToken().transfer(params.redeemer, offRampBalance - fee);

        // Transfer fee from contract to fee collector
        if (fee > 0) {
            params.liquidityProvider.liquidityToken().transfer(IFeeManager(params.feeManager).feeCollector(), fee);
        }
    }

    /**
     * @dev Calculates the fee amount
     */
    function _getFee(address feeManager, uint256 amount) private view returns (uint256) {
        IFeeManager feeManagerInstance = IFeeManager(feeManager);
        return feeManagerInstance.getFee(amount);
    }
}
