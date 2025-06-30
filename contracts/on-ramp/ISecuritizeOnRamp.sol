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

import {Errors} from "../common/Errors.sol";

interface ISecuritizeOnRamp is Errors {

    error InvalidEIP712Signature();
    error IncorrectParamLength();
    error TransactionTooOldError();
    error OnlySecuritizeOnRampError();
    error InvestorSubscriptionDisabledError();
    error SameValueError();

    /**
     * @dev Emitted for a new subscription agreement
     * @param _from investor
     * @param _dsTokenValue asset amount
     * @param _liquidityValue stable coin amount
     * @param _newWalletTo wallet recipient
     */
    event Swap(
        address indexed _from,
        uint256 _dsTokenValue,
        uint256 _liquidityValue,
        address indexed _newWalletTo
    );

    /**
     * @dev Emitted when an existing investor buy assets
     * @param _from investor
     * @param _liquidityAmount stable coin amount
     * @param _dsTokenAmount asset amount
     * @param _navRate nav rate
     */
    event Buy(
        address indexed _from,
        uint256 _liquidityAmount,
        uint256 _dsTokenAmount,
        uint256 _navRate
    );

    /**
     * @dev Emitted for a new subscription agreement
     * @param _from investor
     * @param _agreementHash Document hash
     */
    event DocumentSigned (
        address indexed _from,
        bytes32 _agreementHash
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
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _investorId investor sender (blockchainId). BlockchainId should be created by main-api
     * @param _investorWallet: address of the investor. It should be previously approved
     * @param _investorCountry: investor country
     * @param _investorAttributeIds attributes to set.
     * @param _investorAttributeValues values to set.
     * @param _investorAttributeExpirations expiration values.
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     * @param _liquidityAmount send to issuer's wallet
     * @param _blockLimit max block number when pre-approved transaction does not work anymore
     * @param _agreementHash hash of PDF document created before starting swap operation.
     */
    function subscribe(
        string memory _investorId,
        address _investorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations,
        uint256 _minOutAmount,
        uint256 _liquidityAmount,
        uint256 _blockLimit,
        bytes32 _agreementHash
    ) external;

    /**
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _dsTokenAmount the amount of DSTokens to mint to investor's new wallet
     * @param _maxLiquidityAmount maximum expected amount of stable coin to be paid by the investor
     */
    function swapFor(uint256 _dsTokenAmount, uint256 _maxLiquidityAmount) external;

    /**
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _liquidityAmount amount of stable coin that investor will spend
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     */
    function swap(uint256 _liquidityAmount, uint256 _minOutAmount) external;

    /**
     * @dev Validates off-chain EIP-712 message signature and executes encoded transaction data.
     * @param signature - eip712 signature
     * @param senderInvestor investor id created by registryService
     * @param destination address
     * @param data encoded transaction data. For example issue token
     * @param params array. params[0] = value, params[1] = gasLimit
     */
    function executePreApprovedTransaction(
        bytes memory signature,
        string memory senderInvestor,
        address destination,
        address executor,
        bytes memory data,
        uint256[] memory params
    ) external;

    /**
     * @dev Returns nonce per investor
     * @param _investorId investor (blockchainId).
     */
    function nonceByInvestor(string memory _investorId) external returns (uint256);

    /**
     * @dev Calculates the DSToken amount using current NAV rate.
     * @param _liquidityAmount the amount of stable coins
     * @return dsTokenAmount The calculated amount of DSToken
     */
    function calculateDsTokenAmount(uint256 _liquidityAmount) external returns (uint256);

    /**
     * @dev Convert dsToken to liquiditys using current NAV rate.
     * @param _dsTokenAmount the amount of dsToken
     * @return liquidityAmount The amount of liquidityAmount
     */
    function calculateLiquidityAmount(uint256 _dsTokenAmount) external returns (uint256);

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
     * @notice This method enable/disable headless methods (swap/swapFor)
     * @dev Update the investor subscription feature
     * @param _investorSubscription new value
     */
    function toggleInvestorSubscription(bool _investorSubscription) external;

    /**
     * @notice Update bridge configuration
     * @dev chain Id is not EVM chain id, please refer to https://wormhole.com/docs/build/reference/chain-ids/
     * @param _chainId new chain id
     * @param _bridge new bridge address
     */
    function updateBridgeParams(uint16 _chainId, address _bridge) external;
}
