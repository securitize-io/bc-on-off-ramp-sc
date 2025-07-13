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

import {ISecuritizeOnRamp} from "../ISecuritizeOnRamp.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {Errors} from "../../common/Errors.sol";

/**
 * @title IAssetProvider
 */
interface IAssetProvider is Errors {
    /**
     * @dev Supplies assets to a recipient
     * @param _buyer Assets recipient
     * @param _amount Amount of assets to transfer
     */
    function supplyTo(address _buyer, uint256 _amount) external;

    /**
     * @dev Returns the asset.
     * @return asset address.
     */
    function asset() external view returns (IDSToken);

    /**
     * @dev The securitize on ramp contract.
     * @return The address of the securitize on ramp contract.
     */
    function securitizeOnRamp() external view returns (ISecuritizeOnRamp);
}
