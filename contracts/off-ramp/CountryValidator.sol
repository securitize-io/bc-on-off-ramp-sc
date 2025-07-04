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
     * @param redeemer Address of the redeemer
     * @param dsServiceConsumer DS service consumer contract
     * @param restrictedCountries Mapping of restricted countries
     */
    function validateCountryRestriction(
        address redeemer,
        IDSServiceConsumer dsServiceConsumer,
        mapping(string => bool) storage restrictedCountries
    ) internal view {
        string memory redeemerCountry = getCountry(redeemer, dsServiceConsumer);
        if (restrictedCountries[redeemerCountry]) {
            revert ISecuritizeOffRampErrors.RestrictedCountry(redeemerCountry);
        }
    }

    /**
     * @dev Returns the country code for a redeemer
     * @param redeemer Address of the redeemer
     * @param dsServiceConsumer DS service consumer contract
     * @return Country code string
     */
    function getCountry(address redeemer, IDSServiceConsumer dsServiceConsumer) internal view returns (string memory) {
        IDSRegistryService registryService = IDSRegistryService(
            dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE())
        );

        string memory country = registryService.getCountry(registryService.getInvestor(redeemer));
        validateCountryCode(country);
        return country;
    }

    /**
     * @dev Validates country code format
     * @param country Country code to validate
     */
    function validateCountryCode(string memory country) internal pure {
        if (bytes(country).length == 0) {
            revert ISecuritizeOffRampErrors.EmptyCountryCode();
        }

        if (bytes(country).length != 2 && bytes(country).length != 3) {
            revert ISecuritizeOffRampErrors.InvalidCountryCodeLength(bytes(country).length);
        }

        // Check first character
        if (bytes(country)[0] < 0x41 || bytes(country)[0] > 0x5A) {
            revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(0, bytes(country)[0]);
        }

        // Check second character
        if (bytes(country)[1] < 0x41 || bytes(country)[1] > 0x5A) {
            revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(1, bytes(country)[1]);
        }

        // Check third character if exists
        if (bytes(country).length == 3) {
            // Check if third character is uppercase
            if (bytes(country)[2] < 0x41 || bytes(country)[2] > 0x5A) {
                revert ISecuritizeOffRampErrors.NonUppercaseCountryCode(2, bytes(country)[2]);
            }
        }
    }
}
