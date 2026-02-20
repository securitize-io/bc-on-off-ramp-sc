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
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOffRamp} from "../IBaseOffRamp.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";
import {ILiquidityProvider} from "./ILiquidityProvider.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";

contract CollateralLiquidityProvider is ICollateralLiquidityProvider, BaseContract {
    using SafeERC20 for IERC20Metadata;

    /**
     * @dev liquidity token.
     */
    IERC20Metadata public liquidityToken;

    /**
     * @dev collateral token (externalCollateralRedemption.asset()).
     */
    IERC20Metadata public collateralToken;

    /**
     * @dev securitize redemption contract.
     */
    IBaseOffRamp public securitizeOffRamp;

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

    /**
     * @inheritdoc ICollateralLiquidityProvider
     */
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
        liquidityToken = IERC20Metadata(_liquidityToken);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
        if (
            address(ILiquidityProvider(address(ISecuritizeOffRamp(_externalCollateralRedemption).liquidityProvider())).liquidityToken())
            != _liquidityToken
        ) {
            revert LiquidityTokenMismatch();
        }
        externalCollateralRedemption = ISecuritizeOffRamp(_externalCollateralRedemption);
        collateralProvider = _collateralProvider;

        // Set collateralToken from externalCollateralRedemption.asset()
        collateralToken = IERC20Metadata(address(externalCollateralRedemption.asset()));
    }

    /**
     * @notice Sets a new external collateral redemption implementation.
     * @param _externalCollateralRedemption Address of the external collateral redemption contract.
     */
    function setExternalCollateralRedemption(address _externalCollateralRedemption) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_externalCollateralRedemption == address(0)) {
            revert NonZeroAddressError();
        }

        if (
            address(ILiquidityProvider(address(ISecuritizeOffRamp(_externalCollateralRedemption).liquidityProvider())).liquidityToken())
            != address(liquidityToken)
        ) {
            revert LiquidityTokenMismatch();
        }
        emit ExternalCollateralRedemptionUpdated(address(externalCollateralRedemption), address(_externalCollateralRedemption));
        externalCollateralRedemption = ISecuritizeOffRamp(_externalCollateralRedemption);
    }

    /**
     * @notice Sets collateral provider wallet.
     * @param _collateralProvider Address providing collateral asset.
     */
    function setCollateralProvider(address _collateralProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit CollateralProviderUpdated(collateralProvider, address(_collateralProvider));
        collateralProvider = _collateralProvider;
    }

    /**
     * @notice Returns the currently available liquidity.
     * @return Available liquidity amount.
     */
    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    /**
     * @dev Computes the currently available liquidity for this provider.
     * @return Minimum between external redemption liquidity and collateral capacity.
     */
    function _availableLiquidity() private view returns (uint256) {
        return
            Math.min(
                externalCollateralRedemption.availableLiquidity(),
                externalCollateralRedemption.calculateLiquidityTokenAmountBeforeFee(
                    collateralToken.balanceOf(collateralProvider)
                )
            );
    }

    /**
     * @notice Supplies liquidity tokens to a redeemer.
     * @param _redeemer Recipient of liquidity tokens.
     * @param _liquidityAmount Requested liquidity token amount.
     * @return amountToSupply Liquidity actually supplied.
     */
    function supplyTo(
        address _redeemer,
        uint256 _liquidityAmount
    ) public whenNotPaused onlySecuritizeRedemption returns (uint256 amountToSupply) {
        if (_liquidityAmount > _availableLiquidity()) {
            revert InsufficientLiquidity(_liquidityAmount, _availableLiquidity());
        }

        uint256 collateralAmount = _liquidityTokenToExternalCollateralToken(_liquidityAmount);

        // Take collateral funds from collateral provider
        collateralToken.transferFrom(collateralProvider, address(this), collateralAmount);

        // Approve external redemption
        collateralToken.approve(address(externalCollateralRedemption), collateralAmount);

        // Get liquidity
        externalCollateralRedemption.redeem(collateralAmount, 0);

        // Discount the fee charged by the external collateral redemption
        amountToSupply = externalCollateralRedemption.calculateLiquidityTokenAmount(collateralAmount);

        // Supply redeemer
        liquidityToken.safeTransfer(_redeemer, amountToSupply);
    }

    /**
     * @inheritdoc ILiquidityProvider
     */
    function calculateEffectiveLiquidityTokenAmount(
        uint256 _initialLiquidityAmount
    ) external view returns (uint256 amountToSupply) {
        return _calculateLiquidityTokenAmount(_initialLiquidityAmount);
    }

    /**
     * @dev Converts liquidity amount to supplied amount through external redemption.
     * @param _liquidityAmount Liquidity token amount requested.
     * @return amountToSupply Effective liquidity token amount supplied to redeemer.
     */
    function _calculateLiquidityTokenAmount(uint256 _liquidityAmount) private view returns (uint256 amountToSupply) {
        // Convert liquidity amount to collateral amount
        uint256 collateralAmount = _liquidityTokenToExternalCollateralToken(_liquidityAmount);
        amountToSupply = externalCollateralRedemption.calculateLiquidityTokenAmount(collateralAmount);
    }

    /**
     * @dev Converts liquidity token amount to collateral token amount using NAV rate.
     * @param _liquidityAmount Liquidity token amount.
     * @return collateralAmount Collateral token equivalent.
     */
    function _liquidityTokenToExternalCollateralToken(
        uint256 _liquidityAmount
    ) private view returns (uint256 collateralAmount) {
        // rate is expressed in collateral decimals
        uint256 rate = externalCollateralRedemption.navProvider().rate();

        // NOTE: IDSToken interface lacks decimals(), so we use IERC20Metadata to get decimals from the collateral token
        // TODO: update this when IDSToken has decimals
        uint8 collateralDecimals = collateralToken.decimals();

        collateralAmount =
            ((_liquidityAmount * (10 ** collateralDecimals)) * (10 ** collateralDecimals)) /
            (rate * (10 ** liquidityToken.decimals()));
    }
}
