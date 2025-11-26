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
import {BaseContract} from "../common/BaseContract.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {TokenDataStore} from "@securitize/digital_securities/contracts/data-stores/TokenDataStore.sol";
import {RedemptionManager} from "./RedemptionManager.sol";
import {CountryValidator} from "./CountryValidator.sol";
import {RedemptionValidator} from "./RedemptionValidator.sol";
import {TokenCalculator} from "./TokenCalculator.sol";

abstract contract BaseOffRamp is IBaseOffRamp, EIP712Upgradeable, BaseContract {

    IDSToken public asset;
    uint256 internal assetDecimals;

    uint256 internal liquidityDecimals;
    ILiquidityProvider public liquidityProvider;

    ISecuritizeNavProvider public navProvider;
    IDSServiceConsumer public dsServiceConsumer;

    mapping(string => bool) public restrictedCountries;

    bool public twoStepTransfer;

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

    modifier nonZeroNavRate() {
        if (navProvider.rate() <= 0) {
            revert NonZeroNavRateError();
        }
        _;
    }

    modifier nonZeroLiquidityProvider() {
        if (address(liquidityProvider) == address(0)) {
            revert NonZeroAddressError();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function updateLiquidityProvider(
        address _liquidityProvider
    ) public virtual override onlyOwner addressNonZero(_liquidityProvider) {
        address oldProvider = address(liquidityProvider);
        liquidityProvider = ILiquidityProvider(_liquidityProvider);

        uint256 _liquidityDecimals = IERC20Metadata(address(liquidityProvider.liquidityToken())).decimals();
        if (_liquidityDecimals > 18) {
            revert ExcessiveDecimals(_liquidityDecimals, 18);
        }
        liquidityDecimals = _liquidityDecimals;

        emit LiquidityProviderUpdated(oldProvider, _liquidityProvider);
    }

    function updateNavProvider(address _navProvider) public virtual override onlyOwner addressNonZero(_navProvider) {
        address oldProvider = address(navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, address(navProvider));
    }

    function calculateLiquidityTokenAmount(
        uint256 assetAmount
    ) public view virtual override nonZeroLiquidityProvider returns (uint256 liquidityTokenAmount, uint256 rate, uint256 fee) {
        rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        uint256 amountBeforeFee = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmount = liquidityProvider.calculateEffectiveLiquidityTokenAmount(amountBeforeFee);
        fee = TokenCalculator.calculateFee(feeManager, effectiveAmount);
        liquidityTokenAmount = effectiveAmount - fee;
    }

    function availableLiquidity() external view override nonZeroLiquidityProvider returns (uint256) {
        return liquidityProvider.availableLiquidity();
    }

    function calculateLiquidityTokenAmountBeforeFee(uint256 assetAmount) public view override nonZeroLiquidityProvider returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        return TokenCalculator.calculateLiquidityTokenAmountBeforeFee(assetAmount, rate, liquidityDecimals, assetDecimals);
    }

    function toggleTwoStepTransfer(bool _twoStepTransfer) external override onlyOwner {
        twoStepTransfer = _twoStepTransfer;
        emit TwoStepTransferUpdated(twoStepTransfer);
    }

    function updateCountryRestriction(string memory country, bool isRestricted) external override onlyOwner {
        _updateCountryRestriction(country, isRestricted);
    }

    function updateCountriesRestriction(string[] memory countries, bool isRestricted) external override onlyOwner {
        for (uint256 i = 0; i < countries.length; i++) {
            _updateCountryRestriction(countries[i], isRestricted);
        }
    }

    function _updateCountryRestriction(string memory country, bool isRestricted) internal {
        CountryValidator.validateCountryCode(country);
        restrictedCountries[country] = isRestricted;
        emit CountryRestrictionUpdated(country, isRestricted);
    }

    function _initializeBaseOffRamp(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) internal onlyInitializing addressNonZero(_asset) addressNonZero(_navProvider) addressNonZero(_feeManager) {
        __BaseContract_init();

        uint256 _assetDecimals = TokenDataStore(_asset).decimals();
        if (_assetDecimals > 18) {
            revert ExcessiveDecimals(_assetDecimals, 18);
        }

        asset = IDSToken(_asset);
        dsServiceConsumer = IDSServiceConsumer(_asset);
        navProvider = ISecuritizeNavProvider(_navProvider);
        feeManager = _feeManager;
        assetBurn = _assetBurn;
        assetDecimals = _assetDecimals;
        assetAddress = _asset;
    }

    function _redeem(
        uint256 assetAmount,
        uint256 minOutputAmount,
        uint256 rate,
        address redeemer
    ) internal nonZeroLiquidityProvider returns (uint256 fee, uint256 liquidityValue) {
        if (rate == 0) {
            revert NonZeroNavRateError();
        }

        RedemptionValidator.validateRedemption(redeemer, assetAmount, asset);
        CountryValidator.validateCountryRestriction(redeemer, dsServiceConsumer, restrictedCountries);

        uint256 liquidityTokenAmount = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );

        RedemptionManager.RedemptionParams memory params = RedemptionManager.RedemptionParams({
            asset: asset,
            liquidityProvider: liquidityProvider,
            feeManager: feeManager,
            assetAmount: assetAmount,
            liquidityTokenAmount: liquidityTokenAmount,
            minOutputAmount: minOutputAmount,
            redeemer: redeemer,
            assetBurn: assetBurn
        });

        if (twoStepTransfer) {
            (fee, liquidityValue) = RedemptionManager.executeTwoStepRedemption(params, address(this));
        } else {
            (fee, liquidityValue) = RedemptionManager.executeSingleStepRedemption(params);
        }
    }
}
