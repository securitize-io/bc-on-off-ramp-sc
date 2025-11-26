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
import {IRegularOffRamp} from "../IRegularOffRamp.sol";

/**
 * @title ICollateralLiquidityProvider
 */
interface ICollateralLiquidityProvider is ILiquidityProvider {
    /**
     * @dev Emitted when owner updates external collateral Redemption address.
     * @param oldExternalCollateralRedemption Old external collateral redemption address
     * @param newExternalCollateralRedemption New external collateral redemption address
     */
    event ExternalCollateralRedemptionUpdated(
        address oldExternalCollateralRedemption,
        address newExternalCollateralRedemption
    );

    /**
     * @dev Proxy Initializer.
     * @param _liquidityToken liquidity token that the asset is being redeemed for.
     * @param _recipient wallet address that receives digital assets..
     * @param _securitizeOffRamp The address of the securitize redemption contract.
     * @param _externalCollateralRedemption The address of the external collateral redemption smart contract.
     * @param _collateralProvider The address of the wallet that provides collateral asset.
     **/
    function initialize(
        address _liquidityToken,
        address _recipient,
        address _securitizeOffRamp,
        address _externalCollateralRedemption,
        address _collateralProvider
    ) external;

    /**
     * @dev Emitted when owner updates collateral Provider address.
     * @param oldCollateralProvider Old external collateral Provider address
     * @param newCollateralProvider New external collateral Provider address
     */
    event CollateralProviderUpdated(address oldCollateralProvider, address newCollateralProvider);

    /**
     * @dev Set external collateral redemption implementation.
     * @param _externalCollateralRedemption The address of the external collateral redemption smart contract.
     */
    function setExternalCollateralRedemption(address _externalCollateralRedemption) external;

    /**
     * @dev Set collateral provider wallet.
     * @param _collateralProvider The address of the wallet that provides collateral asset.
     */
    function setCollateralProvider(address _collateralProvider) external;

    /**
     * @dev The external collateral implementation to get liquidity.
     * @return The address of the external collateral redemption implementation.
     */
    function externalCollateralRedemption() external view returns (IRegularOffRamp);
}
