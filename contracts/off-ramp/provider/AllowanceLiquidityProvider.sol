/**
 * Copyright 2024 Securitize Inc. All rights reserved.
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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";

contract AllowanceLiquidityProvider is IAllowanceLiquidityProvider, BaseContract {
    /**
     * @dev liquidity asset.
     */
    IERC20 public liquidityToken;

    /**
     * @dev securitize redemption contract.
     */
    ISecuritizeOffRamp public securitizeOffRamp;

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
    error MinOutputAmountExceeded(uint256 minOutputAmount, uint256 amount);
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

    function initialize(
        address _liquidityToken,
        address _recipient,
        address _securitizeOffRamp
    ) public onlyProxy initializer {
        if (_recipient == address(0)) {
            revert NonZeroAddressError();
        }
        if (_liquidityToken == address(0)) {
            revert NonZeroAddressError();
        }
        if (_securitizeOffRamp == address(0)) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        recipient = _recipient;
        liquidityToken = IERC20(_liquidityToken);
        securitizeOffRamp = ISecuritizeOffRamp(_securitizeOffRamp);
    }

    function setAllowanceProviderWallet(address _liquidityProviderWallet) external onlyOwner {
        if (_liquidityProviderWallet == address(0)) {
            revert NonZeroAddressError();
        }
        address oldAddress = liquidityProviderWallet;
        liquidityProviderWallet = _liquidityProviderWallet;
        emit AllowanceLiquidityProviderWalletUpdated(oldAddress, liquidityProviderWallet);
    }

    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    function _availableLiquidity() private view returns (uint256) {
        // Minimum between balance and allowance
        return
            Math.min(
                liquidityToken.balanceOf(liquidityProviderWallet),
                liquidityToken.allowance(liquidityProviderWallet, address(this))
            );
    }

    function supplyTo(address redeemer, uint256 amount, uint256) public whenNotPaused onlySecuritizeRedemption {
        if (amount > _availableLiquidity()) {
            revert InsufficientLiquidity(amount, _availableLiquidity());
        }

        // transfer liquidity token from liquidity provider wallet to redeemer
        liquidityToken.transferFrom(liquidityProviderWallet, redeemer, amount);
    }
}
