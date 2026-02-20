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
    mapping(address => string) private addressToInvestorId;
    mapping(string => string) private investorIdToCountry;
    mapping(address => bool) private registeredWallets;
    address public wallet;
    string internal investorCountry;

    function updateInvestor(
        string calldata _id,
        string calldata /*_collisionHash*/,
        string memory _country,
        address[] memory _wallets,
        uint8[] memory /*_attributeIds*/,
        uint256[] memory /*_attributeValues*/,
        uint256[] memory /*_attributeExpirations*/
    ) public returns (bool) {
        wallet = _wallets[0];
        addressToInvestorId[_wallets[0]] = _id;
        investorCountry = _country;
        investorIdToCountry[_id] = _country;
        registeredWallets[_wallets[0]] = true;
        return true;
    }

    function addWallet(address _wallet) public {
        wallet = _wallet;
        registeredWallets[_wallet] = true;
    }

    function isWallet(address _wallet) public view returns (bool) {
        return registeredWallets[_wallet];
    }

    function getInvestor(address _wallet) public view returns (string memory) {
        string memory investorId = addressToInvestorId[_wallet];
        return investorId;
    }

    function getCountry(string memory id) public view returns (string memory) {
        return investorIdToCountry[id];
    }

    function setCountry(string calldata _id, string memory _country) public virtual returns (bool) {
        investorIdToCountry[_id] = _country;
        return true;
    }
}
