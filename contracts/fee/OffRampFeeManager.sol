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

pragma solidity 0.8.22;

import {IFeeManager} from "./IFeeManager.sol";

/**
 * @title IFeeManager
 * @dev Interface for managing fees in the on/off ramp protocol
 */
contract FeeManager is IFeeManager {
    uint256 public constant FEE_DENOMINATOR = 100_000;
    uint256 public redemptionFee;
    address public feeCollector;

    event RedemptionFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeCollectorUpdated(address oldCollector, address newCollector);
    error InvalidRedemptionFee(uint256 redemptionFee);
    error InvalidFeeCollectorAddress();

    constructor(uint256 _initialFee, address _feeCollector) {
        redemptionFee = _initialFee;
        feeCollector = _feeCollector;
    }

    /**
     * @dev Returns the computed fee
     */
    function getFee(uint256 amount) external view returns (uint256) {
        return (amount * redemptionFee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR; // Round up to avoid zero fees
    }

    // TODO: Add access control to restrict who can set the fee
    /**
     * @dev Sets the redemption fee
     * @param _redemptionFee Fee percentage in basis points (1/100th of a percent)
     */
    function setRedemptionFee(uint256 _redemptionFee) external {
        if (_redemptionFee > FEE_DENOMINATOR) {
            revert InvalidRedemptionFee(_redemptionFee);
        }

        uint256 oldFee = redemptionFee;
        redemptionFee = _redemptionFee;
        emit RedemptionFeeUpdated(oldFee, _redemptionFee);
    }

    // TODO: Add modifiers to restrict access to only the fee collector or owner
    /**
     * @dev Sets the fee collector address
     * @param _feeCollector Address to collect fees
     */
    function setFeeCollector(address _feeCollector) external {
        if (_feeCollector == address(0)) {
            revert InvalidFeeCollectorAddress();
        }
        address oldCollector = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(oldCollector, _feeCollector);
    }
}
