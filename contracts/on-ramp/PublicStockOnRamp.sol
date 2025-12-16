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

import {IPublicStockOnRamp} from "./IPublicStockOnRamp.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseOnRamp} from "./BaseOnRamp.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {ISecuritizeAmmNavProvider} from "../interfaces/ISecuritizeAmmNavProvider.sol";

contract PublicStockOnRamp is IPublicStockOnRamp, BaseOnRamp {

    string public constant NAME = "PublicStockOnRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH = keccak256("Swap(uint256 liquidityAmount,uint256 minOutputAmount)");

    ISecuritizeAmmNavProvider public navProvider;

    error PriceExpiredError();
    error NavProviderNotSetError();

    modifier initializedNavProvider() {
        if (address(navProvider) == address(0)) {
            revert NavProviderNotSetError();
        }
        _;
    }

    modifier nonZeroAnchorPrice(uint256 _anchorPrice) {
        if (_anchorPrice == 0) {
            revert NonZeroNavRateError();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _dsToken,
        address _liquidity,
        address _navProvider,
        address _feeManager,
        address _custodianWallet
    ) public override initializer onlyProxy {
        __BaseOnRamp_init(NAME, VERSION);

        dsToken = IDSServiceConsumer(_dsToken);
        liquidityToken = IERC20Metadata(_liquidity);
        custodianWallet = _custodianWallet;
        feeManager = IFeeManager(_feeManager);

        // Initialize NAV provider for PublicStockOnRamp (AMM type)
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
    }

    /**
     * @notice Updates the NAV provider implementation.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
    }

    function swap(
        uint256 _liquidityAmount,
        uint256 _minOutAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 _marketStatus,
        uint256 _anchorPrice,
        uint256 _anchorPriceExpiresAt
    )
        public
        whenNotPaused
        investorExists(_investorWallet)
        initializedNavProvider
        validateMinSubscriptionAmount(_liquidityAmount)
        nonZeroAnchorPrice(_anchorPrice)
        onlyRole(OPERATOR_ROLE)
    {
        // Validate anchor price hasn't expired
        if (block.timestamp > _anchorPriceExpiresAt) {
            revert PriceExpiredError();
        }

        // Validate investor signature
        validateInvestorSignature(_liquidityAmount, _minOutAmount, _investorWallet, _investorSignature);

        // Calculate fee first
        uint256 fee = feeManager.getFee(_liquidityAmount);
        uint256 liquidityAmountExcludingFee = _liquidityAmount - fee;

        // Get actual price from AMM NAV provider
        // For OnRamp, we BUY base tokens (user pays quote/liquidity tokens, receives base/DS tokens)
        (, uint256 execPrice) = navProvider.executeBuyBase(
            liquidityAmountExcludingFee,
            _anchorPrice,
            _marketStatus
        );

        // Calculate DS tokens using AMM execution price
        uint256 dsTokenAmount = _calculateDsTokenAmountWithPrice(liquidityAmountExcludingFee, execPrice);

        _swap(_liquidityAmount, dsTokenAmount, _minOutAmount, _investorWallet);
        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _investorWallet, execPrice, fee, address(liquidityToken));
    }

    /**
     * Calculates the amount of DS tokens that would be received for a given amount of liquidity tokens
     * Uses the AMM NAV provider to get the execution price and calculates the token conversion
     * @param _liquidityAmount The amount of liquidity tokens to be converted
     * @param _anchorPrice The anchor price used for price calculation (1e18 fixed-point)
     * @param _marketStatus Current market status (0 = closed, 1 = open)
     * @return dsTokenAmount The amount of DS tokens that would be received
     * @return rate The execution price used for the conversion (token decimal fixed-point)
     * @return fee The fee amount in liquidity tokens
     */
    function calculateDsTokenAmount(
        uint256 _liquidityAmount,
        uint256 _anchorPrice,
        uint8 _marketStatus
    ) public view initializedNavProvider nonZeroAnchorPrice(_anchorPrice) returns (uint256 dsTokenAmount, uint256 rate, uint256 fee) {
        // Calculate fee first
        fee = feeManager.getFee(_liquidityAmount);
        uint256 liquidityAmountExcludingFee = _liquidityAmount - fee;

        // Get execution price from AMM with net amount
        (, rate) = navProvider.quoteBuyBase(liquidityAmountExcludingFee, _anchorPrice, _marketStatus);

        uint8 liquidityTokenDecimals = IERC20Metadata(address(liquidityToken)).decimals();
        uint8 assetDecimals = IERC20Metadata(address(assetProvider.asset())).decimals();
        dsTokenAmount = (liquidityAmountExcludingFee * (10 ** (2 * assetDecimals))) / (rate * (10 ** liquidityTokenDecimals));
    }

    function _calculateDsTokenAmountWithPrice(uint256 _liquidityAmountExcludingFee, uint256 _execPrice) private view returns (uint256 dsTokenAmount) {
        uint8 liquidityTokenDecimals = IERC20Metadata(address(liquidityToken)).decimals();
        uint8 assetDecimals = IERC20Metadata(address(assetProvider.asset())).decimals();

        dsTokenAmount = (_liquidityAmountExcludingFee * (10 ** (2 * assetDecimals))) / (_execPrice * (10 ** liquidityTokenDecimals));
    }

    /**
     * @notice Validates the EIP-712 signature provided by the investor for the swap transaction
     * @dev Uses EIP-712 signature verification to ensure the transaction is authorized by the investor
     * @param _liquidityAmount The amount of liquidity tokens to be swapped
     * @param _minOutAmount The minimum amount of DS tokens expected to receive
     * @param _investorWallet The wallet address of the investor
     * @param _investorSignature The EIP-712 signature of the investor
     * @custom:throws InvalidEIP712SignatureError if the signature is invalid or signer doesn't match investor wallet
     */
    function validateInvestorSignature(uint256 _liquidityAmount, uint256 _minOutAmount, address _investorWallet, bytes memory _investorSignature) private view {
        bytes32 digest = hashTx(_liquidityAmount, _minOutAmount);
        address signer = ECDSA.recover(digest, _investorSignature);
        if (signer != _investorWallet) {
            revert InvalidEIP712SignatureError();
        }
    }

    /// @dev Computes the digest to sign (EIP-712)
    function hashTx(uint256 _liquidityAmount, uint256 _minOutAmount) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TXTYPE_HASH, _liquidityAmount, _minOutAmount)
        );

        return _hashTypedDataV4(structHash);
    }
}
