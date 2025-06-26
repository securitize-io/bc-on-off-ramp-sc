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

import "../redemption/IFeeManager.sol";

contract MockFeeManager is IFeeManager {
    uint256 public redemptionFee;

    event RedemptionFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(uint256 _initialFee) {
        redemptionFee = _initialFee;
    }

    function getFee(uint256 /*amount*/) external view returns (uint256) {
        return redemptionFee;
    }

    function updateRedemptionFee(uint256 _redemptionFee) external {
        if (_redemptionFee > 100_000) {
            revert ExcessiveFee(_redemptionFee, 100_000);
        }

        uint256 oldFee = redemptionFee;
        redemptionFee = _redemptionFee;
        emit RedemptionFeeUpdated(oldFee, _redemptionFee);
    }
}
