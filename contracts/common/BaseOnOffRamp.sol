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

import {BaseContract} from "../common/BaseContract.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {IOnOffRamp} from "./IOnOffRamp.sol";

abstract contract BaseOnOffRamp is IOnOffRamp, EIP712Upgradeable, BaseContract {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    bool public twoStepTransfer;

    uint256[48] private __gap;

    function __BaseOnOffRamp_init(string memory name, string memory version) internal onlyInitializing {
        __EIP712_init(name, version);
        __BaseContract_init();
    }

    /**
     * @notice Enables or disables the two-step transfer flow.
     * @param _twoStepTransfer Desired two-step transfer flag.
     */
    function toggleTwoStepTransfer(bool _twoStepTransfer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_twoStepTransfer == twoStepTransfer) {
            revert SameValueError();
        }
        twoStepTransfer = _twoStepTransfer;
        emit TwoStepTransferUpdated(_twoStepTransfer);
    }

    /**
     * @dev Checks if an address has the admin role
     * @param account Address to check
     * @return bool True if the address has admin role
     */
    function isAdmin(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    /**
     * @dev Checks if an address has the operator role
     * @param account Address to check
     * @return bool True if the address has operator role
     */
    function isOperator(address account) public view returns (bool) {
        return hasRole(OPERATOR_ROLE, account);
    }

    /**
     * @dev Grants operator role to an address
     * @param operator Address to grant operator role
     */
    function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(OPERATOR_ROLE, operator);
    }

    /**
     * @dev Revokes operator role from an address
     * @param operator Address to revoke operator role
     */
    function removeOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(OPERATOR_ROLE, operator);
    }
}
