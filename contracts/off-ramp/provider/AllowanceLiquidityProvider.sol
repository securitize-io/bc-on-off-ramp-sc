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

import {BaseContract} from "../../common/BaseContract.sol";
import {IAllowanceLiquidityProvider} from "./IAllowanceLiquidityProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOffRamp} from "../IBaseOffRamp.sol";

contract AllowanceLiquidityProvider is IAllowanceLiquidityProvider, BaseContract {
    using SafeERC20 for IERC20Metadata;

    /**
     * @dev liquidity asset.
     */
    IERC20Metadata public liquidityToken;

    /**
     * @dev securitize redemption contract.
     */
    IBaseOffRamp public securitizeOffRamp;

    /**
     * @dev recipient wallet.
     */
    address public recipient;

    /**
     * @dev liquidity provider wallet.
     */
    address public liquidityProviderWallet;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error RedemptionUnauthorizedAccount(address account);
    error AvailableLiquidityExceeded(uint256 availableLiquidity, uint256 amount);

    /**
     * @dev Throws if called by any account other than the redemption contract.
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
     * @inheritdoc IAllowanceLiquidityProvider
     */
    function initialize(
        address _liquidityToken,
        address _recipient,
        address _securitizeOffRamp,
        address _liquidityProviderWallet
    ) public onlyProxy initializer {
        if (
            _recipient == address(0) ||
            _liquidityToken == address(0) ||
            _securitizeOffRamp == address(0) ||
            _liquidityProviderWallet == address(0)
        ) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        recipient = _recipient;
        liquidityToken = IERC20Metadata(_liquidityToken);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
        liquidityProviderWallet = _liquidityProviderWallet;
    }

    /**
     * @notice Sets allowance provider wallet.
     * @param _liquidityProviderWallet Wallet that provides liquidity.
     */
    function setAllowanceProviderWallet(address _liquidityProviderWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_liquidityProviderWallet == address(0)) {
            revert NonZeroAddressError();
        }
        emit AllowanceLiquidityProviderWalletUpdated(liquidityProviderWallet, _liquidityProviderWallet);
        liquidityProviderWallet = _liquidityProviderWallet;
    }

    /**
     * @notice Returns the currently available liquidity.
     * @return Available liquidity amount.
     */
    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    /**
     * @dev Internal helper that returns current available liquidity.
     * @return Minimum between balance and allowance from provider wallet.
     */
    function _availableLiquidity() private view returns (uint256) {
        IERC20Metadata _liquidityToken = liquidityToken;
        address _liquidityProviderWallet = liquidityProviderWallet;
        // Minimum between balance and allowance
        return
            Math.min(
                _liquidityToken.balanceOf(_liquidityProviderWallet),
                _liquidityToken.allowance(_liquidityProviderWallet, address(this))
            );
    }

    /**
     * @notice Supplies liquidity tokens to a redeemer.
     * @param _redeemer Recipient of liquidity tokens.
     * @param _liquidityAmount Requested liquidity token amount.
     * @return Liquidity actually supplied.
     */
    function supplyTo(
        address _redeemer,
        uint256 _liquidityAmount
    ) public whenNotPaused onlySecuritizeRedemption returns (uint256) {
        if (_liquidityAmount > _availableLiquidity()) {
            revert InsufficientLiquidity(_liquidityAmount, _availableLiquidity());
        }

        // transfer liquidity token from liquidity provider wallet to redeemer
        liquidityToken.safeTransferFrom(liquidityProviderWallet, _redeemer, _liquidityAmount);

        return _liquidityAmount;
    }

    /**
     * @inheritdoc ILiquidityProvider
     */
    /**
     * @notice Calculates effective liquidity token amount (1:1 in this provider).
     * @param _initialLiquidityAmount Requested liquidity amount.
     * @return amountToSupply Effective liquidity to supply.
     */
    function calculateEffectiveLiquidityTokenAmount(
        uint256 _initialLiquidityAmount
    ) external pure returns (uint256 amountToSupply) {
        return _initialLiquidityAmount;
    }
}
