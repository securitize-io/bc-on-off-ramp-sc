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

import {ILiquidityProvider} from "./ILiquidityProvider.sol";

/**
 * @title ICollateralLiquidityProvider
 */
interface IAllowanceLiquidityProvider is ILiquidityProvider {
    /**
     * @dev Emitted when owner updates collateral Provider address.
     * @param oldProvider Old allowance liquidity provider address
     * @param newProvider New allowance liquidity provider address
     */
    event AllowanceLiquidityProviderWalletUpdated(address oldProvider, address newProvider);

    /**
     * @dev Proxy Initializer.
     * @param _liquidityToken liquidity token that the asset is being redeemed for.
     * @param _recipient wallet address that receives digital assets..
     * @param _securitizeOffRamp The address of the securitize redemption contract.
     * @param _liquidityProviderWallet The address of the wallet that provides liquidity.
     */
    function initialize(
        address _liquidityToken,
        address _recipient,
        address _securitizeOffRamp,
        address _liquidityProviderWallet
    ) external;

    /**
     * @dev Set collateral provider wallet.
     * @param _liquidityProviderWallet The address of the wallet that provides collateral asset.
     */
    function setAllowanceProviderWallet(address _liquidityProviderWallet) external;
}
