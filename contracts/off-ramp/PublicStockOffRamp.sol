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

contract PublicStockOffRamp is IPublicStockOffRamp, BaseOffRamp {

    string public constant NAME = "PublicStockOffRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH = keccak256("Redeem(uint256 assetAmount,uint256 minOutputAmount)");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes PublicStockOffRamp implementation.
     * @param _asset DS asset address.
     * @param _navProvider NAV provider address.
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
        _initializeBaseOffRamp(_asset, _navProvider, _feeManager, _assetBurn);
    }

    /**
     * @notice Redeems asset tokens for liquidity tokens with off-chain signed approval and provided NAV.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     * @param _investorWallet Address of the investor signing the transaction.
     * @param _investorSignature Signature authorizing redemption.
     * //param _marketStatus Current market status (TODO: add all markets status when are defined).
     * @param _anchorPrice NAV price used for redemption.
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 /*_marketStatus*/, // TODO define market status enum
        uint256 _anchorPrice // TODO get the price evaluating market status (new nav provider)
    )
        public
        override
        whenNotPaused
        nonZeroNavRate
    {
        bytes32 digest = hashTx(_assetAmount, _minOutputAmount);
        address signer = ECDSA.recover(digest, _investorSignature);
        if (signer != _investorWallet) {
            revert InvalidEIP712SignatureError();
        }

        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, _anchorPrice, _investorWallet);

        emit RedemptionCompleted(
            _msgSender(),
            _assetAmount,
            liquidityValue,
            _anchorPrice,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }

    /**
     * @notice Calculates liquidity tokens for a given asset amount using a provided NAV rate.
     * @param _assetAmount Asset amount to redeem.
     * @param _navRate NAV rate used for conversion.
     * @return liquidityTokenAmount Liquidity tokens after fees.
     * @return usedRate NAV rate applied.
     * @return fee Fee charged in liquidity tokens.
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount,
        uint256 _navRate
    ) public view override nonZeroLiquidityProvider returns (uint256 liquidityTokenAmount, uint256 usedRate, uint256 fee) {
        if (_navRate == 0) {
            revert NonZeroNavRateError();
        }
        uint256 amountBeforeFee = TokenCalculator.calculateLiquidityTokenAmountBeforeFee(
            _assetAmount,
            _navRate,
            liquidityDecimals,
            assetDecimals
        );
        uint256 effectiveAmount = liquidityProvider.calculateEffectiveLiquidityTokenAmount(amountBeforeFee);
        fee = TokenCalculator.calculateFee(feeManager, effectiveAmount);
        liquidityTokenAmount = effectiveAmount - fee;
        usedRate = _navRate;
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
