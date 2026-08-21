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
 * @title  MockGroveBasinNoCapacity
 * @notice Test-only GroveBasin stub that satisfies the token-wiring validation but does NOT expose
 *         {IPSMAdapter.availableAsset}.
 * @dev    Stands in for a plain Grove Basin (PSM3) pool wired into the on-ramp
 *         {ExternalAssetProvider}, which requires the adapter-specific capacity view. Used to
 *         exercise the {ExternalProviderMissingAvailableAsset} revert path in
 *         {ExternalAssetProvider._validateProviderCapabilities} on both the initialization and the
 *         {BaseExternalProvider.setExternalProvider} rotation paths.
 *
 *         The `permissiveFallback` constructor flag selects which half of the probe is exercised:
 *          - `false`: unknown selectors revert, so the `staticcall` fails (`!ok`) — the plain
 *            "function is not there" case.
 *          - `true`: unknown selectors succeed with empty return data, so the probe must reject on
 *            the return-data length. This is the case a `try`/`catch` probe would let through, since
 *            the ABI decode of the missing word reverts outside the `catch`.
 *
 *         It implements no swap logic: the probe runs before the candidate is stored, so no test
 *         using this stub ever reaches a swap.
 */
contract MockGroveBasinNoCapacity {
    address private immutable _collateralToken;
    address private immutable _creditToken;
    bool private immutable _permissiveFallback;

    /// @dev Thrown on any unknown selector while `permissiveFallback` is false.
    error UnknownSelector();

    /**
     * @param collateralToken_ Token returned by {collateralToken}.
     * @param creditToken_ Token returned by {creditToken}.
     * @param permissiveFallback_ True to answer unknown selectors with empty return data instead of
     *        reverting.
     */
    constructor(address collateralToken_, address creditToken_, bool permissiveFallback_) {
        _collateralToken = collateralToken_;
        _creditToken = creditToken_;
        _permissiveFallback = permissiveFallback_;
    }

    /**
     * @notice Answers unknown selectors — including `availableAsset()` — with empty return data, or
     *         reverts, depending on the configured mode.
     * @dev Marked `payable` only to satisfy the linter; the probe reaches it through a `staticcall`,
     *      which never carries value.
     */
    fallback() external payable {
        if (!_permissiveFallback) {
            revert UnknownSelector();
        }
    }

    /**
     * @notice Handles plain ether transfers (empty calldata), mirroring the {fallback} mode.
     * @dev Present only to pair with the `payable` fallback so the compiler does not warn about a
     *      contract that can receive value through unknown selectors but not through a bare send.
     *      No test sends value to this stub; the capability probe uses a `staticcall`.
     */
    receive() external payable {
        if (!_permissiveFallback) {
            revert UnknownSelector();
        }
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

    /**
     * @notice Returns the zero address as the swap token so the wiring validation passes.
     * @dev    Zero never overlaps the (non-zero) collateral or credit tokens, so the
     *         {SwapTokenOverlap} guard is cleared and the candidate reaches the capability probe.
     * @return The zero address.
     */
    function swapToken() external pure returns (address) {
        return address(0);
    }

    /**
     * @notice Returns a non-zero pocket so the wiring validation reaches the capability probe.
     * @return This contract's address.
     */
    function pocket() external view returns (address) {
        return address(this);
    }
}
