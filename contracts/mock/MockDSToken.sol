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

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Test token contract
contract MockDSToken is ERC20 {
    /*
     *  Constants
     */
    uint256 public constant REGISTRY_SERVICE = 4;
    uint256 public constant TRUST_SERVICE = 1;

    address public registryService;
    address public trustService;
    uint8 public tokenDecimals;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _registryService,
        address _trustService
    ) ERC20(_name, _symbol) {
        tokenDecimals = _decimals;
        registryService = _registryService;
        trustService = _trustService;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    /*
     * Public functions
     */
    /// @dev Issues new tokens.
    /// @param _to Address of token receiver.
    /// @param _value Number of tokens to issue.
    function issueTokens(address _to, uint256 _value) public returns (bool) {
        _mint(_to, _value);
        return true;
    }

    function getDSService(uint256 _service) public view returns (address) {
        if (_service == 1) {
            return trustService;
        }
        if (_service == 4) {
            return registryService;
        }
        revert("DS Service not implemented");
    }

    function mint(address _to, uint256 _amount) external returns (bool) {
        _mint(_to, _amount);
        return true;
    }

    function burn(address _from, uint256 _amount, string memory) external returns (bool) {
        _burn(_from, _amount);
        return true;
    }
}
