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

interface IBaseOnRamp is IOnOffRamp {

    error InvalidEIP712SignatureError();
    error InvestorSubscriptionDisabledError();
    error SameValueError();
    error MinSubscriptionAmountError();

    /**
     * @dev Emitted for a new subscription agreement
     * @param from investor
     * @param dsTokenValue asset amount
     * @param liquidityValue stable coin amount
     * @param newWalletTo wallet recipient
     * @param rate nav token rate
     * @param fee fee amount
     * @param liquidityToken the liquidity token
     */
    event Swap(
        address indexed from,
        uint256 dsTokenValue,
        uint256 liquidityValue,
        address indexed newWalletTo,
        uint256 rate,
        uint256 fee,
        address indexed liquidityToken
    );

    /**
     * @dev Emitted when the asset provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event AssetProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when the nav provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event NavProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when the minSubscriptionAmount is updated
     * @param oldValue Old value
     * @param newValue New value
     */
    event MinSubscriptionAmountUpdated(uint256 oldValue, uint256 newValue);

    /**
     * @dev Emitted when the investorSubscriptionEnabled is updated
     * @param newValue New value
     */
    event InvestorSubscriptionUpdated(bool newValue);

    /**
     * @dev Emitted when the bridge params are updated
     * @param chainId the chain id
     * @param bridge the bridge address
     */
    event BridgeParamsUpdated(uint16 chainId, address bridge);

    /**
     * @notice initialize function
     * @param _dsToken securitize asset
     * @param _liquidity stable coin to purchase assets
     * @param _navProvider securitize nav provider
     * @param _feeManager on ramp fee manager
     * @param _custodianWallet stable coin recipient wallet
     */
    function initialize(
        address _dsToken,
        address _liquidity,
        address _navProvider,
        address _feeManager,
        address _custodianWallet
    ) external;

    /**
     * @dev Update the asset provider
     * @param _assetProvider The new asset provider address
     */
    function updateAssetProvider(address _assetProvider) external;

    /**
     * @dev Update the NAV rate provider implementation.
     * @param _navProvider The NAV rate provider implementation address
     */
    function updateNavProvider(address _navProvider) external;

    /**
     * @dev Update the minimum subscription amount
     * @param _minSubscriptionAmount new value
     */
    function updateMinSubscriptionAmount(uint256 _minSubscriptionAmount) external;

    /**
     * @notice This method enable/disable headless method (swap)
     * @dev Update the investor subscription feature
     * @param _investorSubscription new value
     */
    function toggleInvestorSubscription(bool _investorSubscription) external;

    /**
     * @notice This method enable/disable two step transfer feature
     * @param _twoStepTransfer new value
     */
    function toggleTwoStepTransfer(bool _twoStepTransfer) external;

    /**
     * @notice Update bridge configuration
     * @dev chain Id is not EVM chain id, please refer to https://wormhole.com/docs/build/reference/chain-ids/
     * @param _chainId new chain id
     * @param _bridge new bridge address
     */
    function updateBridgeParams(uint16 _chainId, address _bridge) external;
}
