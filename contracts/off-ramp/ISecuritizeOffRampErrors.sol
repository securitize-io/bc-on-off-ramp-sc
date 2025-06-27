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

interface ISecuritizeOffRampErrors {
    /*
     * @dev error selector: 0xeac0d389
     */
    error ZeroAddress(string parameter);
    /*
     * @dev error selector: 0x899c84b8
     */
    error RateNotDefined();
    /*
     * @dev error selector: 0xa952e4e7
     */
    error InsufficientRedeemerBalance(address redeemer, uint256 requested, uint256 available);
    /*
     * @dev error selector: 0xa12d8719
     */
    error RestrictedCountry(string country);
    /*
     * @dev error selector: 0xa17e11d5
     */
    error InsufficientLiquidity(uint256 requested, uint256 available);
    /*
     * @dev error selector: 0x4d78a3cb
     */
    error EmptyCountryCode();
    /*
     * @dev error selector: 0x5179a003
     */
    error InvalidCountryCodeLength(uint256 length);
    /*
     * @dev error selector: 0x3fc25467
     */
    error NonUppercaseCountryCode(uint8 index, bytes1 character);
    /*
     * @dev error selector: 0xfef38516
     */
    error ExcessiveDecimals(uint256 decimals, uint256 maxDecimals);
    /*
     * @dev error selector: 0xd28d3eb5
     */
    error InsufficientOutputAmount(uint256 outputAmount, uint256 minOutputAmount);
}
