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

import {IBaseOffRamp} from "./IBaseOffRamp.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {TokenDataStore} from "@securitize/digital_securities/contracts/data-stores/TokenDataStore.sol";
import {RedemptionManager} from "./RedemptionManager.sol";
import {CountryValidator} from "./CountryValidator.sol";
import {RedemptionValidator} from "./RedemptionValidator.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {BaseOnOffRamp} from "../common/BaseOnOffRamp.sol";

abstract contract BaseOffRamp is IBaseOffRamp, BaseOnOffRamp {

    IDSToken public asset;
    uint256 internal assetDecimals;

    uint256 internal liquidityDecimals;
    ILiquidityProvider public liquidityProvider;

    IDSServiceConsumer public dsServiceConsumer;

    mapping(string => bool) public restrictedCountries;

    address public feeManager;
    address public assetAddress;
    bool public assetBurn;

    /**
     * @dev Throws if the given address is the zero address
     */
    modifier addressNonZero(address _address) {
        if (_address == address(0)) {
            revert NonZeroAddressError();
        }
        _;
    }

    modifier nonZeroLiquidityProvider() {
        if (address(liquidityProvider) == address(0)) {
            revert NonZeroAddressError();
        }
        _;
    }

    function __BaseOnRamp_init(string memory name, string memory version) internal onlyInitializing {
        __BaseOnOffRamp_init(name, version);
        __BaseContract_init();
    }

    /**
     * @notice Updates the liquidity provider implementation.
     * @param _liquidityProvider New liquidity provider address.
     */
    function updateLiquidityProvider(
        address _liquidityProvider
    ) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) addressNonZero(_liquidityProvider) {
        emit LiquidityProviderUpdated(address(liquidityProvider), _liquidityProvider);
        liquidityProvider = ILiquidityProvider(_liquidityProvider);

        uint256 _liquidityDecimals = IERC20Metadata(address(ILiquidityProvider(_liquidityProvider).liquidityToken())).decimals();
        if (_liquidityDecimals > 18) {
            revert ExcessiveDecimals(_liquidityDecimals, 18);
        }
        liquidityDecimals = _liquidityDecimals;
    }

    /**
     * @notice Returns available liquidity from the provider.
     * @return Available liquidity amount.
     */
    function availableLiquidity() external view override nonZeroLiquidityProvider returns (uint256) {
        return liquidityProvider.availableLiquidity();
    }

    /**
     * @notice Updates restriction status for a country.
     * @param _country Country code.
     * @param _isRestricted Whether the country is restricted.
     */
    function updateCountryRestriction(string memory _country, bool _isRestricted) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _updateCountryRestriction(_country, _isRestricted);
    }

    /**
     * @notice Updates restriction status for multiple countries.
     * @param _countries Country codes.
     * @param _isRestricted Whether the countries are restricted.
     */
    function updateCountriesRestriction(string[] memory _countries, bool _isRestricted) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i; i < _countries.length; i++) {
            _updateCountryRestriction(_countries[i], _isRestricted);
        }
    }

    /**
     * @dev Internal helper to update a single country restriction flag.
     * @param _country Country code to update.
     * @param _isRestricted Whether the country should be restricted.
     */
    function _updateCountryRestriction(string memory _country, bool _isRestricted) internal {
        CountryValidator.validateCountryCode(_country);
        restrictedCountries[_country] = _isRestricted;
        emit CountryRestrictionUpdated(_country, _isRestricted);
    }

    /**
     * @dev Internal initializer shared by off-ramp implementations.
     * @param _asset Address of the DS asset token.
     * @param _feeManager Fee manager address.
     * @param _assetBurn Whether redeemed asset is burned.
     */
    function __BaseOffRamp_init(
        address _asset,
        address _feeManager,
        bool _assetBurn,
        string memory name,
        string memory version
    ) internal onlyInitializing addressNonZero(_asset) addressNonZero(_feeManager) {
        __BaseOnOffRamp_init(name, version);

        uint256 _assetDecimals = TokenDataStore(_asset).decimals();
        if (_assetDecimals > 18) {
            revert ExcessiveDecimals(_assetDecimals, 18);
        }

        asset = IDSToken(_asset);
        dsServiceConsumer = IDSServiceConsumer(_asset);
        feeManager = _feeManager;
        assetBurn = _assetBurn;
        assetDecimals = _assetDecimals;
        assetAddress = _asset;
    }

    /**
     * @dev Core redeem flow shared by off-ramps.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     * @param _rate NAV rate used for conversion.
     * @param _redeemer Address performing redemption.
     * @return fee Fee charged in liquidity tokens.
     * @return liquidityValue Amount supplied to redeemer after fee.
     */
    function _redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        uint256 _rate,
        address _redeemer
    ) internal nonZeroLiquidityProvider returns (uint256 fee, uint256 liquidityValue) {
        if (_rate == 0) {
            revert NonZeroNavRateError();
        }

        IDSToken _asset = asset;
        RedemptionValidator.validateRedemption(_redeemer, _assetAmount, _asset);
        CountryValidator.validateCountryRestriction(_redeemer, dsServiceConsumer, restrictedCountries);

        uint256 liquidityTokenAmount = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            _assetAmount,
            _rate,
            liquidityDecimals,
            assetDecimals
        );

        RedemptionManager.RedemptionParams memory params = RedemptionManager.RedemptionParams({
            asset: _asset,
            liquidityProvider: liquidityProvider,
            feeManager: feeManager,
            assetAmount: _assetAmount,
            liquidityTokenAmount: liquidityTokenAmount,
            minOutputAmount: _minOutputAmount,
            redeemer: _redeemer,
            assetBurn: assetBurn
        });

        if (twoStepTransfer) {
            (fee, liquidityValue) = RedemptionManager.executeTwoStepRedemption(params, address(this));
        } else {
            (fee, liquidityValue) = RedemptionManager.executeSingleStepRedemption(params);
        }
    }
}
