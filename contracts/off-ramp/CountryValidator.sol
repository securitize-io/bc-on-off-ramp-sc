/**
 * Copyright 2025 Securitize Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity ^0.8.22;

import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {ISecuritizeOffRampErrors} from "./ISecuritizeOffRampErrors.sol";

/**
 * @title CountryValidator
 * @dev Handles country validation and restriction logic
 */
library CountryValidator {
    /**
     * @dev Validates if a user is from a restricted country
     * @param _redeemer Address of the redeemer
     * @param _dsServiceConsumer DS service consumer contract
     * @param _restrictedCountries Mapping of restricted countries
     */
    function validateCountryRestriction(
        address _redeemer,
        IDSServiceConsumer _dsServiceConsumer,
        mapping(string country => bool isRestricted) storage _restrictedCountries
    ) internal view {
        string memory redeemerCountry = getCountry(_redeemer, _dsServiceConsumer);
        if (_restrictedCountries[redeemerCountry]) {
            revert ISecuritizeOffRampErrors.RestrictedCountry(redeemerCountry);
        }
    }

    /**
     * @dev Returns the country code for a redeemer
     * @param _redeemer Address of the redeemer
     * @param _dsServiceConsumer DS service consumer contract
     * @return country code string
     */
    function getCountry(address _redeemer, IDSServiceConsumer _dsServiceConsumer) internal view returns (string memory country) {
        IDSRegistryService registryService = IDSRegistryService(
            _dsServiceConsumer.getDSService(_dsServiceConsumer.REGISTRY_SERVICE())
        );

        country = registryService.getCountry(registryService.getInvestor(_redeemer));
        validateCountryCode(country);
    }

    /**
     * @dev Validates country code format
     * @param _country Country code to validate
     */
    function validateCountryCode(string memory _country) internal pure {
        if (bytes(_country).length == 0) {
            // If not country is set, skip validation
            return;
        }

        if (bytes(_country).length != 2 && bytes(_country).length != 3) {
            revert ISecuritizeOffRampErrors.InvalidCountryCodeLength(bytes(_country).length);
        }

        // Check first character
        if (bytes(_country)[0] < 0x41 || bytes(_country)[0] > 0x5A) {
            revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(0, bytes(_country)[0]);
        }

        // Check second character
        if (bytes(_country)[1] < 0x41 || bytes(_country)[1] > 0x5A) {
            revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(1, bytes(_country)[1]);
        }

        // Check third character if exists
        if (bytes(_country).length == 3) {
            // Check if third character is uppercase
            if (bytes(_country)[2] < 0x41 || bytes(_country)[2] > 0x5A) {
                revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(2, bytes(_country)[2]);
            }
        }
    }
}
