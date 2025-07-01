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
import {BaseContract} from "../common/BaseContract.sol";

/**
 * @title MbpsFeeManager
 * @notice MBPS Fee Manager implementations
 */
contract MbpsFeeManager is IFeeManager, BaseContract {
    uint256 public constant FEE_DENOMINATOR = 100_000;

    /**
     * @notice Fee expressed in mbps (1 mbps = 0.001%)
     */
    uint256 public fee;

    address public feeCollector;

    event FeeUpdated(uint256 oldFee, uint256 newFee);

    function initialize(
        uint256 _fee,
        address _feeCollector
    ) public onlyProxy initializer {
        __BaseContract_init();
        fee = _fee;
        feeCollector = _feeCollector;
    }

    /**
     * @dev Returns the computed fee
     */
    function getFee(uint256 amount) external view returns (uint256) {
        return (amount * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR; // Round up to avoid zero fees
    }

    /**
     * @dev Sets the fee percentage
     * @param _fee Fee percentage in basis points (1/100th of a percent)
     */
    function setRedemptionFee(uint256 _fee) external onlyOwner {
        uint256 oldFee = fee;
        fee = _fee;
        emit FeeUpdated(oldFee, _fee);
    }

    /**
     * @dev Sets the fee collector address
     * @param _feeCollector Address to collect fees
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) {
            revert NonZeroAddressError();
        }
        address oldCollector = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(oldCollector, _feeCollector);
    }
}
