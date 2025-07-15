/**
 * Copyright 2025 Securitize Inc. All rights reserved.
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

import {ICollateralLiquidityProvider} from "./ICollateralLiquidityProvider.sol";
import {BaseContract} from "../../common/BaseContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";
import {ILiquidityProvider} from "./ILiquidityProvider.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract CollateralLiquidityProvider is ICollateralLiquidityProvider, BaseContract {
    /**
     * @dev liquidity asset.
     */
    IERC20 public liquidityToken;

    /**
     * @dev securitize redemption contract.
     */
    ISecuritizeOffRamp public securitizeOffRamp;

    /**
     * @dev external collateral redemption contract.
     */
    ISecuritizeOffRamp public externalCollateralRedemption;

    /**
     * @dev recipient wallet.
     */
    address public recipient;

    /**
     * @dev collateral provider wallet.
     */
    address public collateralProvider;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error RedemptionUnauthorizedAccount(address account);
    error LiquidityTokenMismatch();

    /**
     * @dev Throws if called by any account other than the redemption contract
     */
    modifier onlySecuritizeRedemption() {
        if (address(securitizeOffRamp) != _msgSender()) {
            revert RedemptionUnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _liquidityToken,
        address _recipient,
        address _securitizeOffRamp,
        address _externalCollateralRedemption,
        address _collateralProvider
    ) public onlyProxy initializer {
        if (
            _recipient == address(0) ||
            _liquidityToken == address(0) ||
            _securitizeOffRamp == address(0) ||
            _externalCollateralRedemption == address(0) ||
            _collateralProvider == address(0)
        ) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        recipient = _recipient;
        liquidityToken = IERC20(_liquidityToken);
        securitizeOffRamp = ISecuritizeOffRamp(_securitizeOffRamp);
        externalCollateralRedemption = ISecuritizeOffRamp(_externalCollateralRedemption);
        collateralProvider = _collateralProvider;
    }

    function setExternalCollateralRedemption(address externalCollateralRedemption_) external onlyOwner {
        if (externalCollateralRedemption_ == address(0)) {
            revert NonZeroAddressError();
        }

        if (
            address(
                ILiquidityProvider(address(ISecuritizeOffRamp(externalCollateralRedemption_).liquidityProvider()))
                    .liquidityToken()
            ) != address(liquidityToken)
        ) {
            revert LiquidityTokenMismatch();
        }
        address oldExternalCollateral = address(externalCollateralRedemption);
        externalCollateralRedemption = ISecuritizeOffRamp(externalCollateralRedemption_);
        emit ExternalCollateralRedemptionUpdated(oldExternalCollateral, address(externalCollateralRedemption));
    }

    function setCollateralProvider(address collateralProvider_) external onlyOwner {
        if (collateralProvider_ == address(0)) {
            revert NonZeroAddressError();
        }
        address oldAddress = collateralProvider;
        collateralProvider = collateralProvider_;
        emit CollateralProviderUpdated(oldAddress, address(collateralProvider));
    }

    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    function _availableLiquidity() private view returns (uint256) {
        return
            Math.min(
                externalCollateralRedemption.availableLiquidity(),
                _calculateLiquidityTokenAmount(
                    IERC20(externalCollateralRedemption.asset()).balanceOf(collateralProvider)
                )
            );
    }

    function supplyTo(
        address redeemer,
        uint256 amount
    ) public whenNotPaused onlySecuritizeRedemption returns (uint256 amountToSupply) {
        if (amount > _calculateLiquidityTokenAmountBeforeFee(amount)) {
            revert InsufficientLiquidity(amount, _calculateLiquidityTokenAmountBeforeFee(amount));
        }

        // Take collateral funds from collateral provider
        IERC20(externalCollateralRedemption.asset()).transferFrom(collateralProvider, address(this), amount);

        // Approve external redemption
        IERC20(externalCollateralRedemption.asset()).approve(address(externalCollateralRedemption), amount);

        // Get liquidity
        externalCollateralRedemption.redeem(amount, 0);

        // Discount the fee charged by the external collateral redemption
        amountToSupply = externalCollateralRedemption.calculateLiquidityTokenAmount(amount);

        // Supply redeemer
        liquidityToken.transfer(redeemer, amountToSupply);
    }

    /**
     * @dev Calculates the amount of liquidity tokens
     * @param amount The amount of asset tokens to redeem
     * @return amountToSupply The amount of liquidity tokens to supply
     */
    function calculateLiquidityTokenAmount(uint256 amount) external view returns (uint256 amountToSupply) {
        return _calculateLiquidityTokenAmount(amount);
    }

    function _calculateLiquidityTokenAmount(uint256 amount) private view returns (uint256 amountToSupply) {
        // Ensure the external collateral redemption is set
        amountToSupply = externalCollateralRedemption.calculateLiquidityTokenAmount(amount);
    }

    function _calculateLiquidityTokenAmountBeforeFee(uint256 amount) private view returns (uint256 amountToSupply) {
        // Ensure the external collateral redemption is set
        amountToSupply = externalCollateralRedemption.calculateLiquidityTokenAmountBeforeFee(amount);
    }
}
