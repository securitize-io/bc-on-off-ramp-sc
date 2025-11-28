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

/**
 * @title ISecuritizeAmmNavProvider
 * @dev Interface for a NAV provider that prices Base/Quote swaps using a
 *      virtual constant-product AMM centered around an externally supplied
 *      anchor price.
 *
 *      - `quoteBuyBase` and `quoteSellBase` are pure view functions used
 *        externally to compute swap outcomes without modifying reserves.
 *
 *      - `executeBuyBase` and `executeSellBase` perform the same math
 *        but also update the virtual AMM reserves.
 *
 *      All prices are expressed as Quote per Base in 1e18 fixed-point (WAD).
 */
interface ISecuritizeAmmNavProvider {

    /**
     * @dev Emitted when the baseline (snapshot) reserves are reset.
     *      Implementations typically also reset the current virtual reserves
     *      to the same values.
     * @param baseBaseline  New baseline base reserves.
     * @param quoteBaseline New baseline quote reserves.
     */
    event BaselineReset(
        uint256 baseBaseline,
        uint256 quoteBaseline
    );

    /**
     * @dev Emitted when a BUY operation is executed (Quote in, Base out)
     *      and virtual reserves are updated.
     * @param caller        Address that initiated the operation.
     * @param amountInQuote Amount of quote token supplied by the user.
     * @param baseOut       Amount of base token sent to the user.
     * @param execPriceWad  Execution price (Quote/Base, 1e18).
     */
    event ExecuteBuy(
        address indexed caller,
        uint256 amountInQuote,
        uint256 baseOut,
        uint256 execPriceWad
    );

    /**
     * @dev Emitted when a SELL operation is executed (Base in, Quote out)
     *      and virtual reserves are updated.
     * @param caller        Address that initiated the operation.
     * @param amountInBase  Amount of base token supplied by the user.
     * @param quoteOut      Amount of quote token sent to the user.
     * @param execPriceWad  Execution price (Quote/Base, 1e18).
     */
    event ExecuteSell(
        address indexed caller,
        uint256 amountInBase,
        uint256 quoteOut,
        uint256 execPriceWad
    );

    /**
     * @dev Quotes a BUY operation (user pays Quote, receives Base)
     *      without modifying virtual reserves.
     *
     * @param amountInQuote  Amount of quote token the user wants to pay
     *                       (raw token units, e.g., 6 decimals for USDC).
     * @param anchorPriceWad Reference fair price (Quote per Base, 1e18 fixed).
     * @param marketStatus   Market status flag (0 = closed, 1 = open).
     *
     * @return baseOut       Expected Base output (after applying fee).
     * @return execPrice     Execution price (Quote/Base, in Base asset decimals).
     */
    function quoteBuyBase(uint256 amountInQuote, uint256 anchorPriceWad, uint8 marketStatus) external view returns (uint256 baseOut, uint256 execPrice);

    /**
     * @dev Quotes a SELL operation (user pays Base, receives Quote)
     *      without modifying virtual reserves.
     *
     * @param amountInBase   Amount of base token the user wants to sell
     *                       (raw token units, e.g., 6 decimals for TSLA).
     * @param anchorPriceWad Reference fair price (Quote per Base, 1e18 fixed).
     * @param marketStatus   Market status flag (0 = closed, 1 = open).
     *
     * @return quoteOut      Expected Quote output (after applying fee).
     * @return execPrice     Execution price (Quote/Base, in Base asset decimals).
     */
    function quoteSellBase(uint256 amountInBase, uint256 anchorPriceWad, uint8 marketStatus) external view returns (uint256 quoteOut, uint256 execPrice);

    /**
     * @dev Executes a BUY (user pays Quote, receives Base)
     *      and updates virtual AMM reserves.
     *
     *      A router should call this function after transferring tokens,
     *      since this function only computes NAV math and updates reserves.
     *
     * @param amountInQuote  Amount of quote token supplied.
     * @param anchorPriceWad Reference price (Quote per Base, 1e18 fixed).
     * @param marketStatus   Market status flag (0 = closed, 1 = open).
     *
     * @return baseOut       Base amount sent to the user.
     * @return execPrice     Execution price (Quote/Base, in Base asset decimals).
     */
    function executeBuyBase(uint256 amountInQuote, uint256 anchorPriceWad, uint8 marketStatus) external returns (uint256 baseOut, uint256 execPrice);

    /**
     * @dev Executes a SELL (user pays Base, receives Quote)
     *      and updates virtual AMM reserves.
     *
     *      A router should call this function after transferring tokens,
     *      since this function only computes NAV math and updates reserves.
     *
     * @param amountInBase   Amount of base token supplied.
     * @param anchorPriceWad Reference price (Quote per Base, 1e18 fixed).
     * @param marketStatus   Market status flag (0 = closed, 1 = open).
     *
     * @return quoteOut      Quote amount sent to the user.
     * @return execPrice     Execution price (Quote/Base, in Base asset decimals).
     */
    function executeSellBase(uint256 amountInBase, uint256 anchorPriceWad, uint8 marketStatus) external returns (uint256 quoteOut, uint256 execPrice);
}
