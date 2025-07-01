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

import {Errors} from "../common/Errors.sol";

/**
 * @title IFeeManager
 * @dev Interface for managing fees in the on/off ramp protocol
 */
interface IFeeManager is Errors {

    event FeeCollectorUpdated(address oldCollector, address newCollector);

    /**
    * @notice the fee collector address
    */
    function feeCollector() external view returns (address);

    /**
     * @dev Returns the computed fee
     * @param amount Amount to calculate fees
     */
    function getFee(uint256 amount) external view returns (uint256);

    /**
     * @dev Sets the fee collector address
     * @param _feeCollector Address to collect fees
     */
    function setFeeCollector(address _feeCollector) external;
}
