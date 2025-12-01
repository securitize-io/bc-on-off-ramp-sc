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

import {ISecuritizeAmmNavProvider} from "../interfaces/ISecuritizeAmmNavProvider.sol";

/**
 * @title MockSecuritizeAmmNavProvider
 * @dev Mock implementation of ISecuritizeAmmNavProvider for testing purposes.
 *      Uses a fixed execution price instead of actual AMM calculations.
 */
contract MockSecuritizeAmmNavProvider is ISecuritizeAmmNavProvider {
    /// @dev Fixed execution price in base asset decimals (e.g., 2000000 for $2 with 6 decimals)
    uint256 public fixedExecutionPrice;

    /**
     * @dev Constructor to set the fixed execution price
     * @param _fixedExecutionPrice Price in base asset decimals (Quote per Base, in base asset decimals)
     */
    constructor(uint256 _fixedExecutionPrice) {
        fixedExecutionPrice = _fixedExecutionPrice;
    }

    /**
     * @inheritdoc ISecuritizeAmmNavProvider
     * @dev Simplified quote that uses fixed price instead of AMM calculations
     * @dev For simplicity, this mock does not perform actual AMM calculations.
     *      It simply returns the fixed execution price and calculates output proportionally.
     */
    function quoteBuyBase(
        uint256 amountInQuote,
        uint256 anchorPriceWad,
        uint8 marketStatus
    ) external view returns (uint256 baseOut, uint256 execPrice) {
        // If anchor price is 0, return 0 exec price (simulates invalid state)
        if (anchorPriceWad == 0) {
            execPrice = 0;
        } else {
            execPrice = fixedExecutionPrice;
        }
        // Not implemented for buy operations in this mock
        baseOut = 0;
    }

    /**
     * @inheritdoc ISecuritizeAmmNavProvider
     * @dev Simplified quote that uses fixed price instead of AMM calculations
     * @dev For sell operations, returns the fixed execution price in base asset decimals
     */
    function quoteSellBase(
        uint256 amountInBase,
        uint256 anchorPriceWad,
        uint8 marketStatus
    ) external view returns (uint256 quoteOut, uint256 execPrice) {
        // If anchor price is 0, return 0 exec price (simulates invalid state)
        if (anchorPriceWad == 0) {
            execPrice = 0;
        } else {
            execPrice = fixedExecutionPrice;
        }
        // The quoteOut is not used by PublicStock contracts, so we return 0 for simplicity
        quoteOut = 0;
    }

    /**
     * @inheritdoc ISecuritizeAmmNavProvider
     * @dev Executes buy and emits event. Uses same calculation as quoteBuyBase.
     */
    function executeBuyBase(
        uint256 amountInQuote,
        uint256 anchorPriceWad,
        uint8 marketStatus
    ) external returns (uint256 baseOut, uint256 execPrice) {
        (baseOut, execPrice) = this.quoteBuyBase(amountInQuote, anchorPriceWad, marketStatus);
        emit ExecuteBuy(msg.sender, amountInQuote, baseOut, execPrice);
    }

    /**
     * @inheritdoc ISecuritizeAmmNavProvider
     * @dev Executes sell and emits event. Uses same calculation as quoteSellBase.
     */
    function executeSellBase(
        uint256 amountInBase,
        uint256 anchorPriceWad,
        uint8 marketStatus
    ) external returns (uint256 quoteOut, uint256 execPrice) {
        (quoteOut, execPrice) = this.quoteSellBase(amountInBase, anchorPriceWad, marketStatus);
        emit ExecuteSell(msg.sender, amountInBase, quoteOut, execPrice);
    }

    /**
     * @dev Helper function for testing - allows changing the execution price
     * @param _newPrice New execution price in base asset decimals
     */
    function setExecutionPrice(uint256 _newPrice) external {
        fixedExecutionPrice = _newPrice;
    }
}
