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

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockGroveBasin} from "./MockGroveBasin.sol";

/**
 * @title  MockPSMAdapter
 * @notice Grove Basin-shaped mock of a PSM adapter (e.g. EthenaPSMAdapter) for integration tests.
 * @dev    Reproduces the two properties that distinguish an adapter from a plain Grove Basin pool and
 *         that {ExternalAssetProvider.availableAsset} depends on:
 *
 *         1. It holds NO credit-token inventory of its own: `_pushAsset` pulls the credit token from a
 *            configurable send custodian ({assetSendCustodian}) via `transferFrom`, exactly as the real
 *            adapter pulls from the PSM's send custodian. Reading the credit-token balance at the
 *            adapter address therefore reports zero even while swaps are fully serviceable.
 *         2. It reports its deliverable capacity through {availableAsset}, a configurable value standing
 *            in for the PSM rate limits (epoch/period caps: global, per-collateral, per-benefactor) plus
 *            the send custodian's inventory and allowance. {setAvailableAssetReverts} simulates an
 *            adapter whose capacity view is unavailable.
 *
 *         Quoting, fees and execution slippage are inherited unchanged from {MockGroveBasin}.
 */
contract MockPSMAdapter is MockGroveBasin {
    using SafeERC20 for IERC20;

    /// @dev Wallet the credit token is pulled from on delivery. Defaults to `address(this)`.
    address public assetSendCustodian;

    /// @dev Capacity reported by {availableAsset}.
    uint256 public reportedAvailableAsset;

    /// @dev When true, {availableAsset} reverts instead of returning a value.
    bool public availableAssetReverts;

    /// @dev Thrown by {availableAsset} while {availableAssetReverts} is set.
    error AvailableAssetUnavailable();

    constructor(address collateralToken_) MockGroveBasin(collateralToken_) {
        assetSendCustodian = address(this);
    }

    /**
     * @notice Sets the wallet the credit token is pulled from on delivery.
     * @dev The custodian must approve this adapter for the credit token. Passing the zero address
     *      restores self-custody (the plain {MockGroveBasin} behaviour).
     * @param newCustodian New send custodian, or the zero address for self-custody.
     */
    function setAssetSendCustodian(address newCustodian) external {
        assetSendCustodian = newCustodian == address(0) ? address(this) : newCustodian;
    }

    /**
     * @notice Sets the capacity reported by {availableAsset}.
     * @param amount Capacity in the credit token's native decimals.
     */
    function setAvailableAsset(uint256 amount) external {
        reportedAvailableAsset = amount;
    }

    /**
     * @notice Toggles whether {availableAsset} reverts.
     * @param shouldRevert True to make {availableAsset} revert with {AvailableAssetUnavailable}.
     */
    function setAvailableAssetReverts(bool shouldRevert) external {
        availableAssetReverts = shouldRevert;
    }

    /**
     * @notice Best-effort upper bound on the credit-token amount deliverable for buy-direction swaps.
     * @dev Declared only here, never on {MockGroveBasin}: a plain Grove Basin (PSM3) pool has no such
     *      view in production, and the on-ramp {ExternalAssetProvider} must keep rejecting one at
     *      wiring time. Reports {reportedAvailableAsset} regardless of the adapter's own credit-token
     *      balance, standing in for the PSM rate limits plus the send custodian's inventory.
     * @return Upper bound on the deliverable credit-token amount.
     */
    function availableAsset() external view returns (uint256) {
        if (availableAssetReverts) {
            revert AvailableAssetUnavailable();
        }
        return reportedAvailableAsset;
    }

    /**
     * @dev Delivers the credit token from {assetSendCustodian} instead of from this contract, so the
     *      adapter never needs inventory. Other tokens keep the inherited custody model.
     */
    function _pushAsset(address asset, address receiver, uint256 amount) internal override {
        if (asset == creditToken && assetSendCustodian != address(this)) {
            IERC20(asset).safeTransferFrom(assetSendCustodian, receiver, amount);
        } else {
            super._pushAsset(asset, receiver, amount);
        }
    }
}
