/**
 * Copyright 2025 Circle Internet Financial, LTD. All rights reserved.
 * Modifications copyright 2025 Securitize Inc.
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

uint256 constant REGISTRY_SERVICE = 4;

contract MockRegistryService {
    address public wallet;
    string internal investorCountry;
    string internal invalidCountryCode;
    bool internal returnInvalidCountry;

    constructor(string memory _investorCountry) {
        investorCountry = _investorCountry;
        returnInvalidCountry = false;
    }

    function setInvalidCountryMode(bool _mode, string memory _invalidCountryCode) public {
        returnInvalidCountry = _mode;
        invalidCountryCode = _invalidCountryCode;
    }

    function getCountry(string memory) public view returns (string memory) {
        if (returnInvalidCountry) {
            return invalidCountryCode;
        }
        return investorCountry;
    }

    function getInvestor(address) public view returns (string memory) {
        return investorCountry; // Returned string does not matter
    }
}
