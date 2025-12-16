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
import {ISecuritizeAmmNavProvider} from "../interfaces/ISecuritizeAmmNavProvider.sol";

contract PublicStockOffRamp is IPublicStockOffRamp, BaseOffRamp {

    string public constant NAME = "PublicStockOffRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH = keccak256("Redeem(uint256 assetAmount,uint256 minOutputAmount,uint256 nonce,uint256 deadline)");

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
        __BaseOffRamp_init(_asset, _feeManager, _assetBurn, NAME, VERSION);

        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
    }

    /**
     * @notice Updates the NAV provider address.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeAmmNavProvider(_navProvider);
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
     * @param _deadline Timestamp after which the signature is no longer valid.
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 _marketStatus,
        uint256 _anchorPrice,
        uint256 _anchorPriceExpiresAt,
        uint256 _deadline
    )
        public
        override
        whenNotPaused
        initializedNavProvider
        onlyRole(OPERATOR_ROLE)
    {
        if (block.timestamp > _anchorPriceExpiresAt) {
            revert PriceExpiredError();
        }

        if (block.timestamp > _deadline) {
            revert SignatureDeadlineExpiredError();
        }

        bytes32 digest = hashTx(_assetAmount, _minOutputAmount, _investorWallet, _deadline);
        address signer = ECDSA.recover(digest, _investorSignature);
        if (signer != _investorWallet) {
            revert InvalidEIP712SignatureError();
        }

        (, uint256 execPrice) = navProvider.executeSellBase(_assetAmount, _anchorPrice, _marketStatus);

        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, execPrice, _investorWallet);

        emit RedemptionCompleted(
            _investorWallet,
            _assetAmount,
            liquidityValue,
            execPrice,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }

    /**
     * @notice Calculates the amount of liquidity tokens that would be received for a given amount of asset tokens
     * @dev Uses the AMM NAV provider to get the execution price and calculates the token conversion
     * @param _assetAmount The amount of asset tokens to be converted
     * @param _anchorPrice The anchor price used for price calculation (1e18 fixed-point)
     * @param _marketStatus Current market status (0 = closed, 1 = open)
     * @return liquidityAmount The amount of liquidity tokens that would be received
     * @return rate The execution price used for the conversion (token decimal fixed-point)
     * @return fee The fee amount in liquidity tokens
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount,
        uint256 _anchorPrice,
        uint8 _marketStatus
    ) public view override nonZeroLiquidityProvider initializedNavProvider nonZeroAnchorPrice(_anchorPrice) returns (uint256 liquidityAmount, uint256 rate, uint256 fee) {
        (, rate) = navProvider.quoteSellBase(_assetAmount, _anchorPrice, _marketStatus);

        uint256 amountBeforeFee = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            _assetAmount,
            rate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmount = liquidityProvider.calculateEffectiveLiquidityTokenAmount(amountBeforeFee);
        fee = TokenCalculator.calculateFee(feeManager, effectiveAmount);
        liquidityAmount = effectiveAmount - fee;
    }

    /**
     * @dev Computes the digest to sign (EIP-712).
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     * @param _investorWallet Address of the investor signing the transaction.
     * @param _deadline Timestamp after which the signature is no longer valid.
     * @return _Digest ready for signature verification.
     */
    function hashTx(uint256 _assetAmount, uint256 _minOutputAmount, address _investorWallet, uint256 _deadline) private returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TXTYPE_HASH, _assetAmount, _minOutputAmount, _useNonce(_investorWallet), _deadline)
        );

        return _hashTypedDataV4(structHash);
    }
}
