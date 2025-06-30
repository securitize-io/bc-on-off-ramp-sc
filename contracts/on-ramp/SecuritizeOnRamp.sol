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

import {BaseContract} from "../common/BaseContract.sol";
import {ISecuritizeOnRamp} from "./ISecuritizeOnRamp.sol";
import {IUSDCBridge} from "./cttp/IUSDCBridge.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {IAssetProvider} from "./provider/IAssetProvider.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SecuritizeOnRamp is ISecuritizeOnRamp, EIP712Upgradeable, BaseContract {

    using Address for address;
    using ECDSA for bytes32;

    string public constant NAME = "SecuritizeOnRamp";
    string public constant VERSION = "1";

    // keccak256("ExecutePreApprovedTransaction(string memory _senderInvestor, address _destination,address _executor,bytes _data, uint256[] memory _params)")
    bytes32 constant TXTYPE_HASH = 0xee963d66f92bd81c2e9b743fdab1cc81cd81a67f7626663992ce230ad0c71b51;

    mapping(string => uint256) internal noncePerInvestor;

    // init params
    IDSServiceConsumer public dsServiceConsumer;
    IERC20Metadata public liquidityToken;
    IAssetProvider public assetProvider;
    ISecuritizeNavProvider public navProvider;
    IFeeManager public feeManager;
    address public custodianWallet;
    IUSDCBridge public USDCBridge;
    uint16 public bridgeChainId;

    // adhoc configuration variables
    uint256 public minSubscriptionAmount;
    bool public investorSubscriptionEnabled;

    function initialize(
        address _dsToken,
        address _liquidity,
        address _navProvider,
        address _feeManager,
        address _custodianWallet
    ) public override initializer onlyProxy {
        __EIP712_init(NAME, VERSION);
        __BaseContract_init();

        dsServiceConsumer = IDSServiceConsumer(_dsToken);
        liquidityToken = IERC20Metadata(_liquidity);
        custodianWallet = _custodianWallet;
        navProvider = ISecuritizeNavProvider(_navProvider);
        feeManager = IFeeManager(_feeManager);
    }

    modifier onlySecuritizeOnRamp() {
        if (_msgSender() != address(this)) {
            revert OnlySecuritizeOnRampError();
        }
        _;
    }

    modifier validateMinSubscriptionAmount(uint256 _amount) {
        if (_amount < minSubscriptionAmount) {
            revert MinSubscriptionAmountError();
        }
        _;
    }

    modifier validateInvestorSubscription() {
        if (!investorSubscriptionEnabled) {
            revert InvestorSubscriptionDisabledError();
        }
        _;
    }

    modifier investorExists() {
        IDSRegistryService registryService = IDSRegistryService(dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE()));
        if (!registryService.isWallet(_msgSender())) {
            revert InvestorNotRegisteredError();
        }
        _;
    }

    modifier nonZeroNavRate() {
        if (navProvider.rate() <= 0) {
            revert NonZeroNavRateError();
        }
        _;
    }

    function nonceByInvestor(string memory _investorId) override public view returns (uint256) {
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
    ) public override whenNotPaused onlySecuritizeOnRamp nonZeroNavRate validateMinSubscriptionAmount(_liquidityAmount) {
        if (_blockLimit < block.number) {
            revert TransactionTooOldError();
        }
        uint256 dsTokenAmount = calculateDsTokenAmount(_liquidityAmount);
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
        assetProvider.supplyTo(_msgSender(), dsTokenAmount);

        emit DocumentSigned (_investorWallet, _agreementHash);
        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _investorWallet);
    }

    function swapFor(
        uint256 _dsTokenAmount,
        uint256 _maxLiquidityAmount
    ) public override whenNotPaused investorExists nonZeroNavRate validateInvestorSubscription {
        if (_dsTokenAmount <= 0) {
            revert NonPositiveAmountError();
        }
        uint256 liquidityAmount = calculateLiquidityAmount(_dsTokenAmount);
        if (liquidityAmount > _maxLiquidityAmount) {
            revert SlippageControlError();
        }
        if (liquidityAmount < minSubscriptionAmount) {
            revert MinSubscriptionAmountError();
        }

        _executeLiquidityTransfer(_msgSender(), liquidityAmount);
        assetProvider.supplyTo(_msgSender(), _dsTokenAmount);

        emit Swap(_msgSender(), _dsTokenAmount, liquidityAmount, _msgSender());
    }

    function swap(
        uint256 _liquidityAmount,
        uint256 _minOutAmount
    ) public override whenNotPaused investorExists nonZeroNavRate validateInvestorSubscription validateMinSubscriptionAmount(_liquidityAmount) {
        uint256 dsTokenAmount = calculateDsTokenAmount(_liquidityAmount);
        if (dsTokenAmount < _minOutAmount) {
            revert SlippageControlError();
        }

        _executeLiquidityTransfer(_msgSender(), _liquidityAmount);
        assetProvider.supplyTo(_msgSender(), dsTokenAmount);

        emit Swap(_msgSender(), dsTokenAmount, _liquidityAmount, _msgSender());
    }

    function executePreApprovedTransaction(
        bytes memory signature,
        string memory senderInvestor,
        address destination,
        address executor,
        bytes memory data,
        uint256[] memory params
    ) public override whenNotPaused {
        if (params.length != 2)  {
            revert IncorrectParamLength();
        }
        doExecuteByInvestor(signature, senderInvestor, destination, data, executor, params);
    }

    function doExecuteByInvestor(
        bytes memory signature,
        string memory _senderInvestorId,
        address _destination,
        bytes memory _data,
        address _executor,
        uint256[] memory _params
    ) internal {
        bytes32 structHash = keccak256(
            abi.encode(
                TXTYPE_HASH,
                keccak256(bytes(_senderInvestorId)),
                _destination,
                _executor,
                noncePerInvestor[_senderInvestorId],
                keccak256(_data),
                keccak256(abi.encodePacked(_params)) // flatten array
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        // Check that the recovered address is an issuer
        IDSTrustService trustService = IDSTrustService(dsServiceConsumer.getDSService(dsServiceConsumer.TRUST_SERVICE()));
        uint256 signerRole = trustService.getRole(signer);
        if (signerRole != trustService.ISSUER() && signerRole != trustService.MASTER()) {
            revert InvalidEIP712Signature();
        }
        noncePerInvestor[_senderInvestorId] = noncePerInvestor[_senderInvestorId] + 1;
        Address.functionCall(_destination, _data);
    }

    function calculateDsTokenAmount(uint256 _liquidityAmount) public override view returns (uint256) {
        uint256 currentNavRate = navProvider.rate();
        return _liquidityAmount * 10 ** IERC20Metadata(address(assetProvider.asset())).decimals() / currentNavRate;
    }

    function calculateLiquidityAmount(uint256 _dsTokenAmount) public override view returns (uint256) {
        return _dsTokenAmount * navProvider.rate() / (10 ** IERC20Metadata(address(assetProvider.asset())).decimals());
    }

    function updateAssetProvider(address _assetProvider) external override onlyOwner {
        if (_assetProvider == address(0)) {
            revert NonZeroAddressError();
        }
        address oldProvider = address(assetProvider);
        assetProvider = IAssetProvider(_assetProvider);
        emit AssetProviderUpdated(oldProvider, _assetProvider);
    }

    function updateNavProvider(address _navProvider) external override onlyOwner {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        address oldProvider = address(_navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, _navProvider);
    }

    function updateMinSubscriptionAmount(uint256 _minSubscriptionAmount) external override onlyOwner {
        uint256 oldValue = minSubscriptionAmount;
        minSubscriptionAmount = _minSubscriptionAmount;
        emit MinSubscriptionAmountUpdated(oldValue, minSubscriptionAmount);
    }

    function updateBridgeParams(uint16 _chainId, address _bridge) external override onlyOwner {
        bridgeChainId = _chainId;
        USDCBridge = IUSDCBridge(_bridge);
        emit BridgeParamsUpdated(_chainId, _bridge);
    }

    function toggleInvestorSubscription(bool _investorSubscription) external override onlyOwner {
        if (_investorSubscription == investorSubscriptionEnabled) {
            revert SameValueError();
        }
        investorSubscriptionEnabled = _investorSubscription;
        emit InvestorSubscriptionUpdated(investorSubscriptionEnabled);
    }

    function _executeLiquidityTransfer(address from, uint256 amount) private {
        if (liquidityToken.balanceOf(_msgSender()) < amount) {
            revert InsufficientERC20BalanceError();
        }

        uint256 fee = feeManager.getFee(amount);
        uint256 amountExcludingFee = amount - fee;
        liquidityToken.transferFrom(from, address(this), amountExcludingFee);
        liquidityToken.transferFrom(from, feeManager.feeCollector(), fee);

        if (bridgeChainId != 0 && address(USDCBridge) != address(0)) {
            liquidityToken.approve(address(USDCBridge), amount);
            USDCBridge.sendUSDCCrossChainDeposit(bridgeChainId, custodianWallet, amountExcludingFee);
        } else {
            liquidityToken.transferFrom(from, custodianWallet, amountExcludingFee);
        }
    }

    function _registerInvestor(
        string memory _senderInvestorId,
        address _newInvestorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations
    ) private {
        IDSRegistryService registryService = IDSRegistryService(dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE()));

        address[] memory investorWallets = new address[](1);
        investorWallets[0] = _newInvestorWallet;
        registryService.updateInvestor(_senderInvestorId, "", _investorCountry, investorWallets, _investorAttributeIds, _investorAttributeValues, _investorAttributeExpirations);
    }
}
