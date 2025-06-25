/**
 * Copyright 2024 Securitize Inc. All rights reserved.
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
import {ISecuritizeRedemption} from "./ISecuritizeRedemption.sol";
import {BaseContract} from "../../common/BaseContract.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {ILiquidityProvider} from "../liquidity/ILiquidityProvider.sol";
import {ISecuritizeNavProvider} from "../nav/ISecuritizeNavProvider.sol";
import {IFeeManager} from "./IFeeManager.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";

contract SecuritizeRedemption is ISecuritizeRedemption, BaseContract {
    /**
     * @dev asset to be redeemed.
     */
    IDSToken public asset;

    /**
     * @dev Cached token decimals for gas optimization
     */
    uint256 private cachedLiquidityDecimals;
    uint256 private cachedAssetDecimals;

    /**
     * @dev liquidity provider implementation.
     */
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
     * @dev Denominator for fee calculation (100% = 100,000)
     */
    uint256 public constant FEE_DENOMINATOR = 100_000;

    /**
     * @dev Restricted countries mapping
     */
    mapping(string => bool) public restrictedCountries;

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
     * @param amount The amount being redeemed
     * @param liquidity The liquidity provided
     * @param rate The rate value
     */
    event RedemptionCompleted(address indexed redeemer, uint256 amount, uint256 liquidity, uint256 rate);

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
     * @dev Custom errors
     */
    error ZeroAddress(string parameter);
    error RateNotDefined();
    error InsufficientRedeemerBalance(address redeemer, uint256 requested, uint256 available);
    error RestrictedCountry(string country);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error EmptyCountryCode();
    error InvalidCountryCodeLength(uint256 length);
    error NonUppercaseCountryCode(uint8 index, bytes1 character);
    error ExcessiveFee(uint256 fee, uint256 maxFee);
    error ExcessiveDecimals(uint256 decimals, uint256 maxDecimals);
    error InsufficientOutputAmount(uint256 outputAmount, uint256 minOutputAmount);

    /**
     * @dev Throws if the given address is the zero address
     */
    modifier addressNonZero(address _address, string memory parameter) {
        if (_address == address(0)) {
            revert ZeroAddress(parameter);
        }
        _;
    }

    /**
     * @dev Throws if not called from the proxy
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public onlyProxy initializer addressNonZero(_asset, "asset") addressNonZero(_navProvider, "navProvider") {
        __BaseDSContract_init();
        asset = IDSToken(_asset);
        navProvider = ISecuritizeNavProvider(_navProvider);
        dsServiceConsumer = IDSServiceConsumer(_asset); // We assume that the asset token implements IDSServiceConsumer

        // Cache asset decimals to save gas
        uint256 assetDecimals = ERC20(_asset).decimals();
        if (assetDecimals > 18) {
            revert ExcessiveDecimals(assetDecimals, 18);
        }

        cachedAssetDecimals = assetDecimals;
        feeManager = _feeManager;
        assetAddress = _asset;
        assetBurn = _assetBurn;
    }

    function updateLiquidityProvider(
        address _liquidityProvider
    ) external onlyOwner addressNonZero(_liquidityProvider, "liquidityProvider") {
        address oldProvider = address(liquidityProvider);
        liquidityProvider = ILiquidityProvider(_liquidityProvider);

        // Cache liquidity decimals to save gas in calculateLiquidityTokenAmount
        uint256 liquidityDecimals = ERC20(address(liquidityProvider.liquidityToken())).decimals();
        if (liquidityDecimals > 18) {
            revert ExcessiveDecimals(liquidityDecimals, 18);
        }
        cachedLiquidityDecimals = liquidityDecimals;

        emit LiquidityProviderUpdated(oldProvider, address(liquidityProvider));
    }

    function updateNavProvider(address _navProvider) external onlyOwner addressNonZero(_navProvider, "navProvider") {
        address oldProvider = address(navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, address(navProvider));
    }

    /**
     * @dev Redeems asset tokens for liquidity tokens
     * @param _amount The amount of asset tokens to redeem
     * @param _minOutputAmount The minimum amount of liquidity tokens that must be received (slippage protection)
     */
    function redeem(uint256 _amount, uint256 _minOutputAmount) external whenNotPaused {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert RateNotDefined();
        }

        if (asset.balanceOf(msg.sender) < _amount) {
            revert InsufficientRedeemerBalance(msg.sender, _amount, asset.balanceOf(msg.sender));
        }

        // Cache liquidityProvider reference to save gas on multiple accesses
        ILiquidityProvider cachedProvider = liquidityProvider;
        if (address(cachedProvider) == address(0)) {
            revert ZeroAddress("liquidityProvider");
        }

        // Verify user's country
        string memory redeemerCountry = _getCountry(msg.sender);
        if (restrictedCountries[redeemerCountry]) {
            revert RestrictedCountry(redeemerCountry);
        }

        uint256 liquidity = _calculateLiquidityTokenAmount(_amount);
        if (cachedProvider.availableLiquidity() < liquidity) {
            revert InsufficientLiquidity(liquidity, cachedProvider.availableLiquidity());
        }

        // Transfer asset to liquidity provider
        if (assetBurn) {
            asset.burn(msg.sender, _amount, "Redemption burn");
        } else {
            asset.transferFrom(msg.sender, cachedProvider.recipient(), _amount);
        }

        uint256 redemptionFee = IFeeManager(feeManager).getFee(IFeeManager.FeeApplicableOperation.Redemption, _amount);

        // Apply fee if it exists
        uint256 liquidityAfterFee = liquidity;
        if (redemptionFee > 0) {
            // Use unchecked math for fee calculation since it cannot overflow
            unchecked {
                liquidityAfterFee = liquidity - (liquidity * redemptionFee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR; // Round up to avoid zero fees
            }
        }

        // Check slippage protection - ensure minimum output amount is met
        if (liquidityAfterFee < _minOutputAmount) {
            revert InsufficientOutputAmount(liquidityAfterFee, _minOutputAmount);
        }

        cachedProvider.supplyTo(msg.sender, liquidityAfterFee, _minOutputAmount);

        emit RedemptionCompleted(msg.sender, _amount, liquidityAfterFee, rate);
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

    /**
     * @dev Calculates the amount of liquidity tokens to provide for a given asset amount
     * @param _amount The amount of asset tokens to redeem
     * @return The amount of liquidity tokens to provide
     */
    function calculateLiquidityTokenAmount(uint256 _amount) public view returns (uint256) {
        return _calculateLiquidityTokenAmount(_amount);
    }

    /**
     * @dev Calculates the amount of liquidity tokens to provide for a given asset amount
     * @param _amount The amount of asset tokens to redeem
     * @return The amount of liquidity tokens to provide
     */
    function _calculateLiquidityTokenAmount(uint256 _amount) private view returns (uint256) {
        uint256 rate = navProvider.rate();

        if (cachedLiquidityDecimals > cachedAssetDecimals) {
            return
                ((_amount * rate) * (10 ** (cachedLiquidityDecimals - cachedAssetDecimals))) /
                (10 ** cachedLiquidityDecimals);
        }
        if (cachedLiquidityDecimals < cachedAssetDecimals) {
            return
                (_amount * rate) /
                (10 ** (cachedAssetDecimals - cachedLiquidityDecimals)) /
                (10 ** cachedLiquidityDecimals);
        }
        return (_amount * rate) / (10 ** cachedAssetDecimals);
    }

    function _updateCountryRestriction(string memory country, bool isRestricted) private {
        _checkCountryCode(country);
        restrictedCountries[country] = isRestricted;
        emit CountryRestrictionUpdated(country, isRestricted);
    }

    /**
     * @dev Returns the country code for a redeemer
     * @param redeemer Address of the redeemer
     * @return Country code string
     */
    function _getCountry(address redeemer) private view returns (string memory) {
        IDSRegistryService registryService = IDSRegistryService(
            dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE())
        );

        string memory country = registryService.getCountry(registryService.getInvestor(redeemer));
        _checkCountryCode(country);
        return country;
    }

    function _checkCountryCode(string memory country) private pure {
        if (bytes(country).length == 0) {
            revert EmptyCountryCode();
        }

        if (bytes(country).length != 2 && bytes(country).length != 3) {
            revert InvalidCountryCodeLength(bytes(country).length);
        }

        if (bytes(country)[0] < 0x41 || bytes(country)[0] > 0x5A) {
            revert NonUppercaseCountryCode(0, bytes(country)[0]);
        }

        if (bytes(country)[1] < 0x41 || bytes(country)[1] > 0x5A) {
            revert NonUppercaseCountryCode(1, bytes(country)[1]);
        }

        if (bytes(country).length == 3) {
            if (bytes(country)[2] < 0x41 || bytes(country)[2] > 0x5A) {
                revert NonUppercaseCountryCode(2, bytes(country)[2]);
            }
        }
    }
}
