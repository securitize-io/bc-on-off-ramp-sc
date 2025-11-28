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

import {IPublicStockOffRamp} from "./IPublicStockOffRamp.sol";
import {BaseOffRamp} from "./BaseOffRamp.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {ISecuritizeAmmNavProvider} from "./ISecuritizeAmmNavProvider.sol";

contract PublicStockOffRamp is IPublicStockOffRamp, BaseOffRamp {

    string public constant NAME = "PublicStockOffRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH = keccak256("Redeem(uint256 assetAmount,uint256 minOutputAmount)");

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

    /**
     * @notice Initializes PublicStockOffRamp implementation.
     * @param _asset DS asset address.
     * @param _navProvider NAV provider address (AMM-based).
     * @param _feeManager Fee manager address.
     * @param _assetBurn Whether redeemed asset is burned.
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public override initializer onlyProxy {
        __EIP712_init(NAME, VERSION);
        _initializeBaseOffRamp(_asset, _feeManager, _assetBurn);

        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
    }

    /**
     * @notice Updates the NAV provider address.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) public onlyOwner {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        address oldProvider = address(navProvider);
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, address(navProvider));
    }

    /**
     * @notice Redeems asset tokens for liquidity tokens with off-chain signed approval and provided NAV.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     * @param _investorWallet Address of the investor signing the transaction.
     * @param _investorSignature Signature authorizing redemption.
     * @param _marketStatus Current market status (0 = closed, 1 = open).
     * @param _anchorPrice NAV price used for redemption (1e18 fixed-point).
     * @param _anchorPriceExpiresAt Timestamp when the anchor price expires.
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 _marketStatus,
        uint256 _anchorPrice,
        uint256 _anchorPriceExpiresAt
    )
        public
        override
        whenNotPaused
        initializedNavProvider
    {
        if (block.timestamp > _anchorPriceExpiresAt) {
            revert PriceExpiredError();
        }

        bytes32 digest = hashTx(_assetAmount, _minOutputAmount);
        address signer = ECDSA.recover(digest, _investorSignature);
        if (signer != _investorWallet) {
            revert InvalidEIP712SignatureError();
        }

        (, uint256 execPrice) = navProvider.executeSellBase(_assetAmount, _anchorPrice, _marketStatus);

        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, execPrice, _investorWallet);

        emit RedemptionCompleted(
            _msgSender(),
            _assetAmount,
            liquidityValue,
            execPrice,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }

    /**
     * @notice Calculates liquidity tokens for a given asset amount using a provided anchor price.
     * @param _assetAmount Asset amount to redeem.
     * @param _anchorPrice Anchor price for conversion (1e18 fixed-point).
     * @param _marketStatus Current market status (0 = closed, 1 = open).
     * @return The amount of liquidity tokens after fees.
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount,
        uint256 _anchorPrice,
        uint8 _marketStatus
    )
        public
        view
        override
        nonZeroLiquidityProvider
        initializedNavProvider
        nonZeroAnchorPrice(_anchorPrice)
        returns (uint256)
    {
        (, uint256 execPrice) = navProvider.quoteSellBase(_assetAmount, _anchorPrice, _marketStatus);

        uint256 amountBeforeFee = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            _assetAmount,
            execPrice,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmount = liquidityProvider.calculateEffectiveLiquidityTokenAmount(amountBeforeFee);
        uint256 fee = TokenCalculator.calculateFee(feeManager, effectiveAmount);
        return effectiveAmount - fee;
    }

    /**
     * @dev Computes the digest to sign (EIP-712).
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     * @return Digest ready for signature verification.
     */
    function hashTx(uint256 _assetAmount, uint256 _minOutputAmount) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TXTYPE_HASH, _assetAmount, _minOutputAmount)
        );

        return _hashTypedDataV4(structHash);
    }
}
