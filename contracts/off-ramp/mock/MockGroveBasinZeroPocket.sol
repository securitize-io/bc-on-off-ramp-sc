/**
 * Copyright 2026 Securitize Inc. All rights reserved.
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
 * @title  MockGroveBasinZeroPocket
 * @notice Test-only GroveBasin stub whose {pocket} always resolves to the zero address.
 * @dev    Used to exercise the {PocketZeroAddressError} revert path in
 *         {GroveBasinLiquidityProvider}. It does not implement swap logic.
 */
contract MockGroveBasinZeroPocket {
    address private immutable _collateralToken;
    address private immutable _creditToken;

    /**
     * @param collateralToken_ Token returned by {collateralToken}.
     * @param creditToken_ Token returned by {creditToken}.
     */
    constructor(address collateralToken_, address creditToken_) {
        _collateralToken = collateralToken_;
        _creditToken = creditToken_;
    }

    /**
     * @notice Always returns the zero address to simulate an unconfigured pocket.
     * @return The zero address.
     */
    function pocket() external pure returns (address) {
        return address(0);
    }

    /**
     * @notice Returns the configured collateral token address.
     * @return The collateral token address.
     */
    function collateralToken() external view returns (address) {
        return _collateralToken;
    }

    /**
     * @notice Returns the configured credit token address.
     * @return The credit token address.
     */
    function creditToken() external view returns (address) {
        return _creditToken;
    }
}
