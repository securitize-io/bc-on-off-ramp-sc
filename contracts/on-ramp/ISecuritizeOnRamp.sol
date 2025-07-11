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

interface ISecuritizeOnRamp is IOnOffRamp {
    error InvalidEIP712SignatureError();
    error IncorrectParamLength();
    error TransactionTooOldError();
    error OnlySecuritizeOnRampError();
    error InvestorSubscriptionDisabledError();
    error SameValueError();
    error MinSubscriptionAmountError();

    /**
     * @dev Tx type - EIP712
     */
    struct ExecutePreApprovedTransaction {
        string senderInvestor;
        address destination;
        bytes data;
        uint256 nonce;
    }

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
     * @dev Emitted when an existing investor buy assets
     * @param _from investor
     * @param _liquidityAmount stable coin amount
     * @param _dsTokenAmount asset amount
     * @param _navRate nav rate
     */
    event Buy(address indexed _from, uint256 _liquidityAmount, uint256 _dsTokenAmount, uint256 _navRate);

    /**
     * @dev Emitted for a new subscription agreement
     * @param _from investor
     * @param _agreementHash Document hash
     */
    event DocumentSigned(address indexed _from, bytes32 _agreementHash);

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
     * @param _investorWallet: investor wallet
     * @param _investorCountry: investor country
     * @param _investorAttributeIds attributes to set.
     * @param _investorAttributeValues values to set.
     * @param _investorAttributeExpirations expiration values.
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     * @param _liquidityAmount send to custodian wallet
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
     * @param _liquidityAmount amount of stable coin that investor will spend
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     */
    function swap(uint256 _liquidityAmount, uint256 _minOutAmount) external;

    /**
     * @dev Validates off-chain EIP-712 message signature and executes encoded transaction data.
     * @param signature - eip712 signature
     * @param txData - tx data
     */
    function executePreApprovedTransaction(
        bytes memory signature,
        ExecutePreApprovedTransaction calldata txData
    ) external;

    /**
     * @dev Returns nonce per investor
     * @param _investorId investor (blockchainId).
     */
    function nonceByInvestor(string memory _investorId) external returns (uint256);

    /**
     * @dev Calculates the DSToken amount using current NAV rate.
     * @param _liquidityAmount the amount of stable coins
     * @return dsTokenAmount
     * @return rate
     * @return fee
     */
    function calculateDsTokenAmount(
        uint256 _liquidityAmount
    ) external returns (uint256 dsTokenAmount, uint256 rate, uint256 fee);

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
