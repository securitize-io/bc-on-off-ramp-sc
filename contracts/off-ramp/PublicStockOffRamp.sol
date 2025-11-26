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

    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public override initializer onlyProxy {
        __EIP712_init(NAME, VERSION);
        _initializeBaseOffRamp(_asset, _navProvider, _feeManager, _assetBurn);
    }

    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 /* _marketStatus*/, // TODO define market status enum
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

    /// @dev Computes the digest to sign (EIP-712)
    function hashTx(uint256 _assetAmount, uint256 _minOutputAmount) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TXTYPE_HASH, _assetAmount, _minOutputAmount)
        );

        return _hashTypedDataV4(structHash);
    }
}
