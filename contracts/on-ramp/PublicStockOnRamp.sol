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
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract PublicStockOnRamp is IPublicStockOnRamp, BaseOnRamp {

    string public constant NAME = "PublicStockOnRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH = keccak256("Swap(uint256 liquidityAmount,uint256 minOutAmount)");

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
        __EIP712_init(NAME, VERSION);
        __BaseContract_init();

        dsToken = IDSServiceConsumer(_dsToken);
        liquidityToken = IERC20Metadata(_liquidity);
        custodianWallet = _custodianWallet;
        navProvider = ISecuritizeNavProvider(_navProvider);
        feeManager = IFeeManager(_feeManager);
    }

    function swap(
        uint256 _liquidityAmount,
        uint256 _minOutAmount,
        address _investorWallet,
        bytes memory _investorSignature,
        uint8 /*_marketStatus*/, // TODO define market status enum
        uint256 _anchorPrice // TODO get the price evaluating market status (new nav provider)
    )
        public
        whenNotPaused
        investorExists
        nonZeroNavRate
        validateMinSubscriptionAmount(_liquidityAmount)
    {
        // validate investor signature
        validateInvestorSignature(_liquidityAmount, _minOutAmount, _investorWallet, _investorSignature);

        (uint256 dsTokenAmount, uint256 rate, uint256 fee) = calculateDsTokenAmount(_liquidityAmount, _anchorPrice); // calculate dsToken using liquidityAmount - fee

        _swap(_liquidityAmount, dsTokenAmount, _minOutAmount, _investorWallet);
        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _investorWallet, rate, fee, address(liquidityToken));
    }

    function calculateDsTokenAmount(uint256 _liquidityAmount, uint256 navPrice) public view returns (uint256 dsTokenAmount, uint256 rate, uint256 fee) {
        fee = feeManager.getFee(_liquidityAmount);
        uint256 liquidityAmountExcludingFee = _liquidityAmount - fee;

        uint8 liquidityTokenDecimals = IERC20Metadata(address(liquidityToken)).decimals();
        uint8 assetDecimals = IERC20Metadata(address(assetProvider.asset())).decimals();

        rate = navPrice;
        dsTokenAmount = (liquidityAmountExcludingFee * (10 ** (2 * assetDecimals))) / (rate * (10 ** liquidityTokenDecimals));
    }

    /// @notice Validates the EIP-712 signature provided by the investor for the swap transaction
    /// @dev Uses EIP-712 signature verification to ensure the transaction is authorized by the investor
    /// @param _liquidityAmount The amount of liquidity tokens to be swapped
    /// @param _minOutAmount The minimum amount of DS tokens expected to receive
    /// @param _investorWallet The wallet address of the investor
    /// @param _investorSignature The EIP-712 signature of the investor
    /// @custom:throws InvalidEIP712SignatureError if the signature is invalid or signer doesn't match investor wallet
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
