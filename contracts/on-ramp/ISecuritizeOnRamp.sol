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

interface ISecuritizeOnRamp {

    /**
     * @dev Emitted for a new subscription agreement
     * @param _from investor
     * @param _dsTokenValue asset amount
     * @param _stableCoinValue stable coin amount
     * @param _newWalletTo nav rate
     */
    event Swap(
        address indexed _from,
        uint256 _dsTokenValue,
        uint256 _stableCoinValue,
        address indexed _newWalletTo
    );

    /**
     * @dev Emitted when an existing investor buy assets
     * @param _from investor
     * @param _stableCoinAmount stable coin amount
     * @param _dsTokenAmount asset amount
     * @param _navRate nav rate
     */
    event Buy(
        address indexed _from,
        uint256 _stableCoinAmount,
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
    * @notice initialize function
    * @param _dsToken securitize asset
    * @param _stableCoin stable coin to purchase assets
    * @param _assetProvider asset provider
    * @param _navProvider securitize nav provider
    * @param _custodianWallet stable coin recipient wallet
    * @param _bridgeChainId wm chain id - zero for no bridging
    * @param _USDCBridge Securitize usdc bridge protocol - zero address for no bridging
    */
    function initialize(
        address _dsToken,
        address _stableCoin,
        address _assetProvider,
        address _navProvider,
        address _custodianWallet,
        uint16 _bridgeChainId,
        address _USDCBridge
    ) external;

    /**
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _senderInvestorId investor sender (blockchainId). BlockchainId should be created by main-api
     * @param _newInvestorWallet: address of the investor. It should be previously approved
     * @param _investorCountry: investor country
     * @param _investorAttributeIds attributes to set.
     * @param _investorAttributeValues values to set.
     * @param _investorAttributeExpirations expiration values.
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     * @param _stableCoinAmount send to issuer's wallet
     * @param _blockLimit max block number when pre-approved transaction does not work anymore
     * @param _agreementHash hash of PDF document created before starting swap operation.
     */
    function subscribe(
        string memory _senderInvestorId,
        address _newInvestorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations,
        uint256 _minOutAmount,
        uint256 _stableCoinAmount,
        uint256 _blockLimit,
        bytes32 _agreementHash
    ) external;

    /**
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _dsTokenAmount the amount of DSTokens to mint to investor's new wallet
     * @param _maxStableCoinAmount maximum expected amount of stable coin to be paid by the investor
     */
    function swapFor(uint256 _dsTokenAmount, uint256 _maxStableCoinAmount) external;

    /**
     * @dev It does a swap between a Stable Coin ERC-20 token and DSToken.
     * @param _stableCoinAmount amount of stable coin that investor will spend
     * @param _minOutAmount minimum amount of DSTokens that are acceptable in return
     */
    function swap(uint256 _stableCoinAmount, uint256 _minOutAmount) external;

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
    * @param _stableCoinAmount the amount of stable coins
    * @return dsTokenAmount The calculated amount of DSToken
    */
    function calculateDsTokenAmount(uint256 _stableCoinAmount) external returns (uint256);

    /**
    * @dev Convert dsToken to stableCoins using current NAV rate.
    * @param _dsTokenAmount the amount of dsToken
    * @return stableCoinAmount The amount of stableCoinAmount
    */
    function calculateStableCoinAmount(uint256 _dsTokenAmount) external returns (uint256);

    /**
     * @dev Update the asset provider
     * @param _assetProvider The new asset provider address
     */
    function updateAssetProvider(address _assetProvider) external;
}
