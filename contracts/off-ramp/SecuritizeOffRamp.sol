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
import {ISecuritizeOffRamp} from "./ISecuritizeOffRamp.sol";
import {BaseContract} from "../common/BaseContract.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {ILiquidityProvider} from "./provider/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {TokenDataStore} from "@securitize/digital_securities/contracts/data-stores/TokenDataStore.sol";
import {RedemptionManager} from "./RedemptionManager.sol";
import {CountryValidator} from "./CountryValidator.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {RedemptionValidator} from "./RedemptionValidator.sol";

contract SecuritizeOffRamp is ISecuritizeOffRamp, BaseContract {
    /**
     * @dev asset to be redeemed.
     */
    IDSToken public asset;

    /**
     * @dev Cached token decimals for gas optimization
     */
    uint256 private assetDecimals;

    /**
     * @dev liquidity provider implementation.
     */
    uint256 private liquidityDecimals;
    ILiquidityProvider public liquidityProvider;

    /**
     * @dev NAV rate provider implementation.
     */
    ISecuritizeNavProvider public navProvider;

    /**
     * @dev Service consumer contract for DS Registry access
     */
    IDSServiceConsumer public dsServiceConsumer;

    /**
     * @dev Restricted countries mapping
     */
    mapping(string => bool) public restrictedCountries;

    /**
     * @dev Two steps mode flag for Dealer role functionality
     * When enabled, assets and liquidity first go to the contract before their final destination
     */
    bool public twoStepTransfer;

    address public feeManager;

    address public assetAddress;

    bool public assetBurn;

    /**
     * @dev Emitted when the liquidity provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event LiquidityProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when NAV rate provider is updated
     * @param oldProvider Old provider address
     * @param newProvider New provider address
     */
    event NavProviderUpdated(address indexed oldProvider, address indexed newProvider);

    /**
     * @dev Emitted when redemption is completed.
     * @param redeemer Initiator of redemption transaction
     * @param dsTokenValue The amount being redeemed
     * @param liquidityValue The liquidity provided
     * @param rate The rate value
     * @param fee The fee applied to the redemption
     * @param liquidityToken The address of the liquidity token used for redemption
     */
    event RedemptionCompleted(
        address indexed redeemer,
        uint256 dsTokenValue,
        uint256 liquidityValue,
        uint256 rate,
        uint256 fee,
        address indexed liquidityToken
    );

    /**
     * @dev Emitted when a country restriction status is updated
     * @param country The country code
     * @param isRestricted Whether the country is restricted
     */
    event CountryRestrictionUpdated(string indexed country, bool isRestricted);

    /**
     * @dev Emitted when the redemption fee is updated
     * @param oldFee Previous fee value in mbps
     * @param newFee New fee value in mbps
     */
    event RedemptionFeeUpdated(uint256 oldFee, uint256 newFee);

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

    /**
     * @dev Throws if not called from the proxy
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public onlyProxy initializer addressNonZero(_asset) addressNonZero(_navProvider) addressNonZero(_feeManager) {
        __BaseContract_init();

        uint256 _assetDecimals = TokenDataStore(_asset).decimals();
        if (_assetDecimals > 18) {
            revert ExcessiveDecimals(_assetDecimals, 18);
        }

        asset = IDSToken(_asset);
        // We assume that the asset token implements IDSServiceConsumer because it's a DS token
        dsServiceConsumer = IDSServiceConsumer(_asset);
        navProvider = ISecuritizeNavProvider(_navProvider);
        feeManager = _feeManager;
        assetBurn = _assetBurn;
        assetDecimals = _assetDecimals;
        assetAddress = _asset;
    }

    /**
     * @dev Redeems asset tokens for liquidity tokens
     * @param assetAmount The amount of asset tokens to redeem
     * @param minOutputAmount The minimum amount of liquidity tokens that must be received (slippage protection)
     */
    function redeem(
        uint256 assetAmount,
        uint256 minOutputAmount
    ) external whenNotPaused nonZeroNavRate nonZeroLiquidityProvider {
        uint256 rate = navProvider.rate();

        // Validate redemption requirements (gas-optimized)
        RedemptionValidator.validateRedemption(_msgSender(), assetAmount, asset);

        // Validate country restrictions
        CountryValidator.validateCountryRestriction(_msgSender(), dsServiceConsumer, restrictedCountries);

        uint256 liquidityTokenAmount = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );

        // Prepare redemption parameters
        RedemptionManager.RedemptionParams memory params = RedemptionManager.RedemptionParams({
            asset: asset,
            liquidityProvider: liquidityProvider,
            feeManager: feeManager,
            assetAmount: assetAmount,
            liquidityTokenAmount: liquidityTokenAmount,
            minOutputAmount: minOutputAmount,
            redeemer: _msgSender(),
            assetBurn: assetBurn
        });

        uint256 fee;
        uint256 liquidityValue;

        // Execute redemption based on mode
        if (twoStepTransfer) {
            (fee, liquidityValue) = RedemptionManager.executeTwoStepRedemption(params, address(this));
        } else {
            (fee, liquidityValue) = RedemptionManager.executeSingleStepRedemption(params);
        }

        emit RedemptionCompleted(
            _msgSender(),
            assetAmount,
            liquidityValue,
            rate,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }

    /**
     * @dev Enables or disables the two steps mode
     * @param twoStepTransfer_ Whether to enable or disable two steps mode
     */
    function toggleTwoStepTransfer(bool twoStepTransfer_) external onlyOwner {
        twoStepTransfer = twoStepTransfer_;
        emit TwoStepTransferUpdated(twoStepTransfer_);
    }

    function updateLiquidityProvider(address _liquidityProvider) external onlyOwner addressNonZero(_liquidityProvider) {
        address oldProvider = address(liquidityProvider);
        liquidityProvider = ILiquidityProvider(_liquidityProvider);

        // Cache liquidity decimals to save gas in calculateLiquidityTokenAmount
        uint256 _liquidityDecimals = ERC20(address(liquidityProvider.liquidityToken())).decimals();
        if (_liquidityDecimals > 18) {
            revert ExcessiveDecimals(_liquidityDecimals, 18);
        }
        liquidityDecimals = _liquidityDecimals;

        emit LiquidityProviderUpdated(oldProvider, address(liquidityProvider));
    }

    function updateNavProvider(address _navProvider) external onlyOwner addressNonZero(_navProvider) {
        address oldProvider = address(navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, address(navProvider));
    }

    /**
     * @dev Calculates the amount of liquidity tokens to provide for a given asset amount
     * @param assetAmount The amount of asset tokens to redeem
     * @return The amount of liquidity tokens to provide
     */
    function calculateLiquidityTokenAmount(uint256 assetAmount) public view returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        uint256 initialLiquidityAmount = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmountToSupply = liquidityProvider.calculateEffectiveLiquidityTokenAmount(
            initialLiquidityAmount
        );
        uint256 fee = TokenCalculator.calculateFee(feeManager, effectiveAmountToSupply);

        return effectiveAmountToSupply - fee;
    }

    function availableLiquidity() external view returns (uint256) {
        return liquidityProvider.availableLiquidity();
    }

    function calculateLiquidityTokenAmountBeforeFee(uint256 assetAmount) public view returns (uint256) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        return
            TokenCalculator.calculateLiquidityTokenAmountBeforeFee(assetAmount, rate, liquidityDecimals, assetDecimals);
    }

    /**
     * @dev Updates the restriction status for a country
     * @param country The country code to update
     * @param isRestricted Whether the country should be restricted
     */
    function updateCountryRestriction(string memory country, bool isRestricted) external onlyOwner {
        _updateCountryRestriction(country, isRestricted);
    }

    function updateCountriesRestriction(string[] memory countries, bool isRestricted) external onlyOwner {
        for (uint256 i = 0; i < countries.length; i++) {
            _updateCountryRestriction(countries[i], isRestricted);
        }
    }

    function _updateCountryRestriction(string memory country, bool isRestricted) private {
        CountryValidator.validateCountryCode(country);
        restrictedCountries[country] = isRestricted;
        emit CountryRestrictionUpdated(country, isRestricted);
    }
}
