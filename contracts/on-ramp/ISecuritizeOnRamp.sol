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

import {IBaseOnRamp} from "./IBaseOnRamp.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";

interface ISecuritizeOnRamp is IBaseOnRamp {

    error IncorrectParamLength();
    error TransactionTooOldError();
    error OnlySecuritizeOnRampError();

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
     * @param _from investor
     * @param _agreementHash Document hash
     */
    event DocumentSigned(address indexed _from, bytes32 _agreementHash);

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
     * @param _investorId investor (blockchainId) - unique identifier for the investor
     * @return uint256 The current nonce value for the specified investor, used for transaction ordering
     */
    function nonceByInvestor(string memory _investorId) external view returns (uint256);

    /**
     * @dev Calculates the amount of DS tokens to be received for a given liquidity amount, including the rate and fee
     * @param _liquidityAmount The amount of liquidity tokens to be converted
     * @return dsTokenAmount The amount of DS tokens that will be received
     * @return rate The current conversion rate between liquidity and DS tokens
     * @return fee The fee amount that will be deducted from the liquidity amount
     */
    function calculateDsTokenAmount(uint256 _liquidityAmount) external view returns (uint256 dsTokenAmount, uint256 rate, uint256 fee);

    /**
     * @dev The current NAV rate provider address
     * @return The address of the NAV rate provider.
     */
    function navProvider() external view returns (ISecuritizeNavProvider);
}
