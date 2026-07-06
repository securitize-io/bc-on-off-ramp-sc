/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {IExternalLiquidityProvider} from "./provider/IExternalLiquidityProvider.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {Errors} from "../common/Errors.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title RedemptionManager
 * @dev Handles the core redemption logic for both single-step and two-step transfers
 */
library RedemptionManager {
    using SafeERC20 for IERC20Metadata;

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
     * @dev Executes single-step redemption.
     * @param _params Redemption parameters payload.
     * @return fee Fee charged in liquidity tokens.
     * @return userSuppliedAmount Amount supplied to redeemer after fee.
     */
    function executeSingleStepRedemption(
        RedemptionParams memory _params
    ) internal returns (uint256 fee, uint256 userSuppliedAmount) {
        // Transfer asset to liquidity provider
        if (_params.assetBurn) {
            _params.asset.burn(_params.redeemer, _params.assetAmount, "Redemption burn");
        } else {
            _params.asset.transferFrom(_params.redeemer, _params.liquidityProvider.recipient(), _params.assetAmount);
        }

        // Apply fee if it exists, transfer it to the fee collector
        fee = TokenCalculator.calculateFee(_params.feeManager, _params.liquidityTokenAmount);

        // Supply liquidity tokens to the fee collector
        if (fee > 0) {
            _params.liquidityProvider.supplyTo(IFeeManager(_params.feeManager).feeCollector(), fee);
        }

        // Supply liquidity tokens to the redeemer
        userSuppliedAmount = _params.liquidityProvider.supplyTo(_params.redeemer, _params.liquidityTokenAmount - fee);

        if (userSuppliedAmount < _params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }
    }

    /**
     * @dev Executes two-step redemption.
     * @param _params Redemption parameters payload.
     * @param _contractAddress Address holding tokens during the two-step process.
     * @return fee Fee charged in liquidity tokens.
     * @return userSuppliedAmount Amount supplied to redeemer after fee.
     */
    function executeTwoStepRedemption(
        RedemptionParams memory _params,
        address _contractAddress
    ) internal returns (uint256 fee, uint256 userSuppliedAmount) {
        // Get DS tokens from investor to contract
        _params.asset.transferFrom(_params.redeemer, _contractAddress, _params.assetAmount);

        // Transfer DS tokens from contract to recipient or burn
        if (_params.assetBurn) {
            _params.asset.burn(_contractAddress, _params.assetAmount, "Redemption burn");
        } else {
            _params.asset.transfer(_params.liquidityProvider.recipient(), _params.assetAmount);
        }

        // Get liquidity from provider to contract
        uint256 suppliedAmount = _params.liquidityProvider.supplyTo(_contractAddress, _params.liquidityTokenAmount);

        // Calculate fee based on supplied amount
        fee = TokenCalculator.calculateFee(_params.feeManager, suppliedAmount);

        userSuppliedAmount = suppliedAmount - fee;
        // Check slippage protection - ensure minimum output amount is met
        if (userSuppliedAmount < _params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }

        // Transfer liquidity tokens from contract to redeemer
        _params.liquidityProvider.liquidityToken().safeTransfer(_params.redeemer, userSuppliedAmount);

        // Transfer fee from contract to fee collector
        if (fee > 0) {
            _params.liquidityProvider.liquidityToken().safeTransfer(IFeeManager(_params.feeManager).feeCollector(), fee);
        }
    }

    /**
     * @dev Executes two-step redemption against an {IExternalLiquidityProvider}, swapping EXACTLY the
     *      redemption's asset amount through Grove Basin. Unlike {executeTwoStepRedemption}, the
     *      provider is driven through {IExternalLiquidityProvider.supplyExactIn} with the redemption's
     *      own `assetAmount`, so a stray asset donation on the provider is neither swept into the
     *      redemption nor able to revert it. Asset burning is unsupported by this provider, so the
     *      asset is always transferred to the provider (never burned) before the swap.
     * @param _params Redemption parameters payload.
     * @param _contractAddress Address holding tokens during the two-step process.
     * @return fee Fee charged in liquidity tokens.
     * @return userSuppliedAmount Amount supplied to redeemer after fee.
     */
    function executeTwoStepRedemptionExactIn(
        RedemptionParams memory _params,
        address _contractAddress
    ) internal returns (uint256 fee, uint256 userSuppliedAmount) {
        // Get DS tokens from investor to contract, then forward to the provider (recipient).
        _params.asset.transferFrom(_params.redeemer, _contractAddress, _params.assetAmount);
        _params.asset.transfer(_params.liquidityProvider.recipient(), _params.assetAmount);

        // Swap EXACTLY this redemption's asset amount; donations/stray balance are ignored.
        uint256 suppliedAmount = IExternalLiquidityProvider(address(_params.liquidityProvider)).supplyExactIn(
            _contractAddress,
            _params.assetAmount,
            _params.liquidityTokenAmount
        );

        // Calculate fee based on supplied amount
        fee = TokenCalculator.calculateFee(_params.feeManager, suppliedAmount);

        userSuppliedAmount = suppliedAmount - fee;
        // Check slippage protection - ensure minimum output amount is met
        if (userSuppliedAmount < _params.minOutputAmount) {
            revert Errors.SlippageControlError();
        }

        // Transfer liquidity tokens from contract to redeemer
        _params.liquidityProvider.liquidityToken().safeTransfer(_params.redeemer, userSuppliedAmount);

        // Transfer fee from contract to fee collector
        if (fee > 0) {
            _params.liquidityProvider.liquidityToken().safeTransfer(IFeeManager(_params.feeManager).feeCollector(), fee);
        }
    }
}
