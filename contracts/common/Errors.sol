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

interface Errors {
    /// @notice Thrown when investor is not registered in whitelist or compliance service
    /// @dev Selector: 0x2225ba19
    error InvestorNotRegisteredError();
    /// @notice Thrown when NAV rate is zero
    /// @dev Selector: 0x432c8777
    error NonZeroNavRateError();
    /// @notice Thrown when amount is zero or negative
    /// @dev Selector: 0x1bf7a6c5
    error NonPositiveAmountError();
    /// @notice Thrown when slippage control check fails
    /// @dev Selector: 0x6cca9a62
    error SlippageControlError();
    /// @notice Thrown when an address parameter is zero
    /// @dev Selector: 0x7ca2e690
    error NonZeroAddressError();
    /// @notice Thrown when ERC20 balance is insufficient
    /// @dev Selector: 0xd1d66863
    error InsufficientERC20BalanceError();
    /// @notice Thrown when trying to replace a value with the same existing value
    /// @dev Selector: 0x4559ff5c
    error SameValueError();
    ///@notice Thrown when EIP-712 signature verification fails during investor swap validation
    ///@dev 0x6a567a1a
    error InvalidEIP712SignatureError();
    ///@notice Thrown when investor signature is expired
    ///@dev 0xa8058425
    error SignatureDeadlineExpiredError();
}
