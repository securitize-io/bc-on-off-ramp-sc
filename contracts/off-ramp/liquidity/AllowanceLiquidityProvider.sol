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
import {ISecuritizeRedemption} from "../redemption/ISecuritizeRedemption.sol";

contract AllowanceLiquidityProvider is IAllowanceLiquidityProvider, BaseContract {
    /**
     * @dev liquidity asset.
     */
    IERC20 public liquidityToken;

    /**
     * @dev securitize redemption contract.
     */
    ISecuritizeRedemption public securitizeRedemption;

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
    error ZeroAddress(string parameter);

    /**
     * @dev Throws if called by any account other than the redemption contract.
     */
    modifier onlySecuritizeRedemption() {
        if (address(securitizeRedemption) != _msgSender()) {
            revert RedemptionUnauthorizedAccount(_msgSender());
        }
        _;
    }

    function initialize(
        address _recipient,
        address _liquidityToken,
        address _securitizeRedemption
    ) public onlyProxy initializer {
        if (_recipient == address(0)) {
            revert ZeroAddress("recipient");
        }
        if (_liquidityToken == address(0)) {
            revert ZeroAddress("liquidityToken");
        }
        if (_securitizeRedemption == address(0)) {
            revert ZeroAddress("securitizeRedemption");
        }
        __BaseContract_init();
        recipient = _recipient;
        liquidityToken = IERC20(_liquidityToken);
        securitizeRedemption = ISecuritizeRedemption(_securitizeRedemption);
    }

    function setAllowanceProviderWallet(address _liquidityProviderWallet) external onlyOwner {
        if (_liquidityProviderWallet == address(0)) {
            revert ZeroAddress("liquidityProviderWallet");
        }
        address oldAddress = liquidityProviderWallet;
        liquidityProviderWallet = _liquidityProviderWallet;
        emit AllowanceLiquidityProviderWalletUpdated(oldAddress, liquidityProviderWallet);
    }

    function availableLiquidity() external view returns (uint256) {
        // Minimum between balance and allowance
        return
            Math.min(
                liquidityToken.balanceOf(liquidityProviderWallet),
                liquidityToken.allowance(liquidityProviderWallet, address(this))
            );
    }

    function supplyTo(
        address _redeemer,
        uint256 _amount,
        uint256 _minOutputAmount
    ) public whenNotPaused onlySecuritizeRedemption {
        require(_minOutputAmount < _amount, "minOutputAmount must be less than amount");

        //transfer liquidity token from liquidity provider wallet to redeemer
        liquidityToken.transferFrom(liquidityProviderWallet, _redeemer, _amount);
    }
}
