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

    bytes32 private constant TXTYPE_HASH =
        keccak256("ExecutePreApprovedTransaction(string senderInvestor,address destination,bytes data,uint256 nonce)");

    mapping(string => uint256) internal noncePerInvestor;

    // init params
    IDSServiceConsumer public dsToken;
    IERC20Metadata public liquidityToken;
    IAssetProvider public assetProvider;
    ISecuritizeNavProvider public navProvider;
    IFeeManager public feeManager;
    address public custodianWallet;

    // adhoc configuration variables
    uint256 public minSubscriptionAmount;
    bool public investorSubscriptionEnabled;
    bool public twoStepTransfer;
    IUSDCBridge public USDCBridge;
    uint16 public bridgeChainId;

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
        IDSRegistryService registryService = IDSRegistryService(dsToken.getDSService(dsToken.REGISTRY_SERVICE()));
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
        investorExists
        nonZeroNavRate
        validateInvestorSubscription
        validateMinSubscriptionAmount(_liquidityAmount)
    {
        (uint256 dsTokenAmount, uint256 rate, uint256 fee) = calculateDsTokenAmount(_liquidityAmount); // calculate dsToken using liquidityAmount - fee
        if (dsTokenAmount < _minOutAmount) {
            revert SlippageControlError();
        }

        _executeLiquidityTransfer(_msgSender(), _liquidityAmount);
        _executeAssetTransfer(_msgSender(), dsTokenAmount);

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

    function calculateDsTokenAmount(uint256 _liquidityAmount) public view returns (uint256 dsTokenAmount, uint256 rate, uint256 fee) {
        fee = feeManager.getFee(_liquidityAmount);
        uint256 liquidityAmountExcludingFee = _liquidityAmount - fee;

        uint8 liquidityTokenDecimals = IERC20Metadata(address(liquidityToken)).decimals();
        uint8 assetDecimals = IERC20Metadata(address(assetProvider.asset())).decimals();

        rate = navProvider.rate(); // assumed to be in `assetDecimals`

        dsTokenAmount = (liquidityAmountExcludingFee * (10 ** (2 * assetDecimals))) / (rate * (10 ** liquidityTokenDecimals));
    }

    function updateAssetProvider(address _assetProvider) external onlyOwner {
        if (_assetProvider == address(0)) {
            revert NonZeroAddressError();
        }
        address oldProvider = address(assetProvider);
        assetProvider = IAssetProvider(_assetProvider);
        emit AssetProviderUpdated(oldProvider, _assetProvider);
    }

    function updateNavProvider(address _navProvider) external onlyOwner {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        address oldProvider = address(_navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
        emit NavProviderUpdated(oldProvider, _navProvider);
    }

    function updateMinSubscriptionAmount(uint256 _minSubscriptionAmount) external onlyOwner {
        uint256 oldValue = minSubscriptionAmount;
        minSubscriptionAmount = _minSubscriptionAmount;
        emit MinSubscriptionAmountUpdated(oldValue, minSubscriptionAmount);
    }

    function updateBridgeParams(uint16 _chainId, address _bridge) external onlyOwner {
        bridgeChainId = _chainId;
        USDCBridge = IUSDCBridge(_bridge);
        emit BridgeParamsUpdated(_chainId, _bridge);
    }

    function toggleInvestorSubscription(bool _investorSubscription) external onlyOwner {
        if (_investorSubscription == investorSubscriptionEnabled) {
            revert SameValueError();
        }
        investorSubscriptionEnabled = _investorSubscription;
        emit InvestorSubscriptionUpdated(investorSubscriptionEnabled);
    }

    function toggleTwoStepTransfer(bool _twoStepTransfer) external onlyOwner {
        if (_twoStepTransfer == twoStepTransfer) {
            revert SameValueError();
        }
        twoStepTransfer = _twoStepTransfer;
        emit TwoStepTransferUpdated(twoStepTransfer);
    }

    function _executeLiquidityTransfer(address from, uint256 amount) private {
        if (liquidityToken.balanceOf(from) < amount) {
            revert InsufficientERC20BalanceError();
        }

        liquidityToken.transferFrom(from, address(this), amount);
        uint256 fee = feeManager.getFee(amount);
        if (fee > 0) {
            liquidityToken.transfer(feeManager.feeCollector(), fee);
        }

        uint256 amountExcludingFee = amount - fee;
        bool bridgeTransfer = bridgeChainId != 0 && address(USDCBridge) != address(0);
        if (bridgeTransfer) {
            liquidityToken.approve(address(USDCBridge), amountExcludingFee);
            USDCBridge.sendUSDCCrossChainDeposit(bridgeChainId, custodianWallet, amountExcludingFee);
        } else {
            liquidityToken.transfer(custodianWallet, amountExcludingFee);
        }
    }

    function _executeAssetTransfer(address to, uint256 amount) private {
        if (twoStepTransfer) {
            assetProvider.supplyTo(address(this), amount);
            IERC20Metadata(address(dsToken)).transfer(to, amount);
        } else {
            assetProvider.supplyTo(to, amount);
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
