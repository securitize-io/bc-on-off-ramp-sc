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
pragma solidity 0.8.22;

import {IFeeManager} from "../fee/IFeeManager.sol";

/**
 * @title MockConfigurableFeeManager
 * @notice Test fee manager with 1e8 (= 100%) precision so percentages such as 1.666666% and
 *         99.999999% are representable exactly. Fee rounds up to mirror {MbpsFeeManager}.
 */
contract MockConfigurableFeeManager is IFeeManager {
    /// @dev 100_000_000 = 100%, i.e. six decimal places of percentage precision.
    uint256 public constant FEE_DENOMINATOR = 100_000_000;

    /// @dev Fee numerator in units of {FEE_DENOMINATOR} (1_000_000 = 1%).
    uint256 public feeNumerator;

    address public feeCollector;

    constructor(uint256 _feeNumerator, address _feeCollector) {
        feeNumerator = _feeNumerator;
        feeCollector = _feeCollector;
    }

    function getFee(uint256 amount) external view returns (uint256) {
        return (amount * feeNumerator + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR; // Round up to avoid zero fees
    }

    function setFeeNumerator(uint256 _feeNumerator) external {
        feeNumerator = _feeNumerator;
    }

    function setFeeCollector(address _feeCollector) external {
        if (_feeCollector == address(0)) {
            revert NonZeroAddressError();
        }
        emit FeeCollectorUpdated(feeCollector, _feeCollector);
        feeCollector = _feeCollector;
    }
}
