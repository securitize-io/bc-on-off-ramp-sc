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

import {IOnOffRamp} from "../common/IOnOffRamp.sol";
import {ISecuritizeOffRampErrors} from "./ISecuritizeOffRampErrors.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";

interface IBaseOffRamp is IOnOffRamp, ISecuritizeOffRampErrors {

    error InvalidEIP712SignatureError();

    /**
     * @dev Emitted when redemption is completed.
     * @param redeemer Initiator of redemption transaction
     * @param dsTokenValue The amount being redeemed
     * @param liquidityValue The liquidity provided
     * @param rate The rate value
     * @param fee The fee applied to the redemption
     * @param liquidityToken The address of the liquidity token used for redemption
     */
    event RedemptionCompleted(
        address indexed redeemer,
        uint256 dsTokenValue,
        uint256 liquidityValue,
        uint256 rate,
        uint256 fee,
        address indexed liquidityToken
    );

    /**
     * @dev Emitted when the liquidity provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event LiquidityProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when NAV rate provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event NavProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when a country restriction status is updated
     * @param country The country code
     * @param isRestricted Whether the country is restricted
     */
    event CountryRestrictionUpdated(string indexed country, bool isRestricted);

    /**
     * @notice initialize function
     * @param _asset securitize asset
     * @param _navProvider securitize nav provider
     * @param _feeManager fee manager
     * @param _assetBurn flag to burn redeemed asset
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) external;

    /**
     * @dev Update the liquidity provider
     * @param _liquidityProvider The new liquidity provider address
     */
    function updateLiquidityProvider(address _liquidityProvider) external;

    /**
     * @dev The available liquidity that can be supplied
     * @return The available liquidity amount
     */
    function availableLiquidity() external view returns (uint256);

    /**
     * @dev Updates the restriction status for a country
     * @param _country The country code to update
     * @param _isRestricted Whether the country should be restricted
     */
    function updateCountryRestriction(string memory _country, bool _isRestricted) external;

    /**
     * @dev Updates the restriction status for an array of countries
     * @param _countries The country codes to update
     * @param _isRestricted Whether the countries should be restricted
     */
    function updateCountriesRestriction(string[] memory _countries, bool _isRestricted) external;

    /**
     * @dev The asset being redeemed.
     * @return The address of the asset token.
     */
    function asset() external view returns (IDSToken);

    /**
     * @dev The address of the asset being redeemed.
     * @return The address of the asset token.
     */
    function assetAddress() external view returns (address);

    /**
     * @dev The current liquidity provider.
     * @return The address of the liquidity provider.
     */
    function liquidityProvider() external view returns (ILiquidityProvider);

    /**
     * @dev The fee manager address
     * @return The fee manager address
     */
    function feeManager() external view returns (address);

    /**
     * @dev Whether the asset is burned during redemption
     * @return True if the asset is burned
     */
    function assetBurn() external view returns (bool);
}
