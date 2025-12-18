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

import {ISecuritizeOnRamp} from "./ISecuritizeOnRamp.sol";
import {BaseOnRamp} from "./BaseOnRamp.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

contract SecuritizeOnRamp is ISecuritizeOnRamp, BaseOnRamp {
    using Address for address;
    using ECDSA for bytes32;

    string public constant NAME = "SecuritizeOnRamp";
    string public constant VERSION = "1";

    bytes32 private constant TXTYPE_HASH =
        keccak256("ExecutePreApprovedTransaction(string senderInvestor,address destination,bytes data,uint256 nonce)");

    mapping(string investor => uint256 nonce) internal noncePerInvestor;

    ISecuritizeNavProvider public navProvider;


    modifier nonZeroNavRate() {
        if (navProvider.rate() <= 0) {
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

        // Initialize navProvider for SecuritizeOnRamp
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @notice Updates the NAV provider address.
     * @param _navProvider New NAV provider address.
     */
    function updateNavProvider(address _navProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    modifier onlySecuritizeOnRamp() {
        if (_msgSender() != address(this)) {
            revert OnlySecuritizeOnRampError();
        }
        _;
    }

    function nonceByInvestor(string memory _investorId) public view returns (uint256) {
        return noncePerInvestor[_investorId];
    }

    function subscribe(
        string memory _investorId,
        address _investorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations,
        uint256 _minOutAmount,
        uint256 _liquidityAmount,
        uint256 _blockLimit,
        bytes32 _agreementHash
    )
        public
        whenNotPaused
        onlySecuritizeOnRamp
        nonZeroNavRate
        validateMinSubscriptionAmount(_liquidityAmount)
    {
        if (_blockLimit < block.number) {
            revert TransactionTooOldError();
        }

        (uint256 dsTokenAmount, uint256 rate, uint256 fee) = calculateDsTokenAmount(_liquidityAmount);
        if (dsTokenAmount < _minOutAmount) {
            revert SlippageControlError();
        }

        _registerInvestor(
            _investorId,
            _investorWallet,
            _investorCountry,
            _investorAttributeIds,
            _investorAttributeValues,
            _investorAttributeExpirations
        );

        _executeLiquidityTransfer(_investorWallet, _liquidityAmount);
        _executeAssetTransfer(_investorWallet, dsTokenAmount);

        emit DocumentSigned(_investorWallet, _agreementHash);
        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _investorWallet, rate, fee, address(liquidityToken));
    }

    function swap(
        uint256 _liquidityAmount,
        uint256 _minOutAmount
    )
        public
        whenNotPaused
        investorExists(_msgSender())
        nonZeroNavRate
        validateInvestorSubscription
        validateMinSubscriptionAmount(_liquidityAmount)
    {
        (uint256 dsTokenAmount, uint256 rate, uint256 fee) = calculateDsTokenAmount(_liquidityAmount); // calculate dsToken using liquidityAmount - fee

        _swap(_liquidityAmount, dsTokenAmount, _minOutAmount, _msgSender());
        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _msgSender(), rate, fee, address(liquidityToken));
    }

    function executePreApprovedTransaction(
        bytes memory signature,
        ExecutePreApprovedTransaction calldata txData
    ) public whenNotPaused {
        bytes32 digest = hashTx(txData);
        address signer = ECDSA.recover(digest, signature);

        // Check recovered address role
        IDSTrustService trustService = IDSTrustService(dsToken.getDSService(dsToken.TRUST_SERVICE()));
        uint256 signerRole = trustService.getRole(signer);
        if (signerRole != trustService.EXCHANGE() && signerRole != trustService.ISSUER()) {
            revert InvalidEIP712SignatureError();
        }
        noncePerInvestor[txData.senderInvestor] = noncePerInvestor[txData.senderInvestor] + 1;
        Address.functionCall(txData.destination, txData.data);
    }

    function calculateDsTokenAmount(uint256 _liquidityAmount) public view returns (uint256 dsTokenAmount, uint256 rate, uint256 fee) {
        fee = feeManager.getFee(_liquidityAmount);
        uint256 liquidityAmountExcludingFee = _liquidityAmount - fee;

        uint8 liquidityTokenDecimals = IERC20Metadata(address(liquidityToken)).decimals();
        uint8 assetDecimals = IERC20Metadata(address(assetProvider.asset())).decimals();

        rate = navProvider.rate(); // assumed to be in `assetDecimals`

        dsTokenAmount = (liquidityAmountExcludingFee * (10 ** (2 * assetDecimals))) / (rate * (10 ** liquidityTokenDecimals));
    }

    /// @dev Computes the digest to sign (EIP-712)
    function hashTx(ExecutePreApprovedTransaction calldata txData) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TXTYPE_HASH,
                keccak256(bytes(txData.senderInvestor)),
                txData.destination,
                keccak256(txData.data),
                noncePerInvestor[txData.senderInvestor]
            )
        );

        return _hashTypedDataV4(structHash);
    }

    function _registerInvestor(
        string memory _senderInvestorId,
        address _newInvestorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations
    ) private {
        IDSRegistryService registryService = IDSRegistryService(dsToken.getDSService(dsToken.REGISTRY_SERVICE()));

        address[] memory investorWallets = new address[](1);
        investorWallets[0] = _newInvestorWallet;
        registryService.updateInvestor(
            _senderInvestorId,
            "",
            _investorCountry,
            investorWallets,
            _investorAttributeIds,
            _investorAttributeValues,
            _investorAttributeExpirations
        );
    }
}
