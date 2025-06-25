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
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAssetProvider} from "./provider/IAssetProvider.sol";

contract SecuritizeOnRamp is ISecuritizeOnRamp, EIP712Upgradeable, BaseContract {

    using Address for address;
    using ECDSA for bytes32;

    string public constant NAME = "SecuritizeOnRamp";
    string public constant VERSION = "1";

    // keccak256("ExecutePreApprovedTransaction(string memory _senderInvestor, address _destination,address _executor,bytes _data, uint256[] memory _params)")
    bytes32 constant TXTYPE_HASH = 0xee963d66f92bd81c2e9b743fdab1cc81cd81a67f7626663992ce230ad0c71b51;

    mapping(string => uint256) internal noncePerInvestor;

    IDSServiceConsumer public dsServiceConsumer;
    IERC20Metadata public stableCoinToken;
    IAssetProvider public assetProvider;
    ISecuritizeNavProvider public navProvider;
    address public custodianWallet;
    IUSDCBridge public USDCBridge;
    uint16 public bridgeChainId;

    function initialize(
        address _dsToken,
        address _stableCoin,
        address _assetProvider,
        address _navProvider,
        address _custodianWallet,
        uint16 _bridgeChainId,
        address _USDCBridge
    ) public override initializer onlyProxy {
        __EIP712_init(NAME, VERSION);
        __BaseContract_init();

        dsServiceConsumer = IDSServiceConsumer(_dsToken);
        stableCoinToken = IERC20Metadata(_stableCoin);
        assetProvider = IAssetProvider(_assetProvider);
        custodianWallet = _custodianWallet;
        navProvider = ISecuritizeNavProvider(_navProvider);
        bridgeChainId = _bridgeChainId;
        USDCBridge = IUSDCBridge(_USDCBridge);
    }

    modifier onlySecuritizeOnRamp() {
        require(_msgSender() == address(this), "Only Securitize on ramp");
        _;
    }

    function nonceByInvestor(string memory _investorId) override public view returns (uint256) {
        return noncePerInvestor[_investorId];
    }

    function subscribe(
        string memory _senderInvestorId,
        address _newInvestorWallet,
        string memory _investorCountry,
        uint8[] memory _investorAttributeIds,
        uint256[] memory _investorAttributeValues,
        uint256[] memory _investorAttributeExpirations,
        uint256 _minOutAmount,
        uint256 _stableCoinAmount,
        uint256 _blockLimit,
        bytes32 _agreementHash
    ) public override whenNotPaused onlySecuritizeOnRamp {
        require(_blockLimit >= block.number, "Transaction too old");
        require(stableCoinToken.balanceOf(_newInvestorWallet) >= _stableCoinAmount, "Not enough stable tokens balance");
        uint256 dsTokenAmount = calculateDsTokenAmount(_stableCoinAmount);
        require(dsTokenAmount >= _minOutAmount, "DSToken mount is lower than acceptable slippage");

        _registerInvestor(
            _senderInvestorId,
            _newInvestorWallet,
            _investorCountry,
            _investorAttributeIds,
            _investorAttributeValues,
            _investorAttributeExpirations
        );

        _executeStableCoinTransfer(_newInvestorWallet, _stableCoinAmount);
        assetProvider.supplyTo(_msgSender(), dsTokenAmount);

        emit DocumentSigned (_newInvestorWallet, _agreementHash);
        emit Swap(_msgSender(), dsTokenAmount, _stableCoinAmount, _newInvestorWallet);
    }

    function swapFor(uint256 _dsTokenAmount, uint256 _maxStableCoinAmount) public override whenNotPaused {
        IDSRegistryService registryService = IDSRegistryService(dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE()));
        require(registryService.isWallet(_msgSender()), "Investor not registered");
        require(_dsTokenAmount > 0, "DSToken amount must be greater than 0");
        require(navProvider.rate() > 0, "NAV Rate must be greater than 0");

        uint256 stableCoinAmount = calculateStableCoinAmount(_dsTokenAmount);
        require(stableCoinAmount <= _maxStableCoinAmount, "Stable coin amount is higher than acceptable slippage");
        require(stableCoinToken.balanceOf(_msgSender()) >= stableCoinAmount, "Not enough stable coin balance");

        _executeStableCoinTransfer(_msgSender(), stableCoinAmount);
        assetProvider.supplyTo(_msgSender(), _dsTokenAmount);

        emit Buy(_msgSender(), _dsTokenAmount, stableCoinAmount, navProvider.rate());
    }

    function swap(uint256 _stableCoinAmount, uint256 _minOutAmount) public override whenNotPaused {
        IDSRegistryService registryService = IDSRegistryService(dsServiceConsumer.getDSService(dsServiceConsumer.REGISTRY_SERVICE()));
        require(registryService.isWallet(_msgSender()), "Investor not registered");
        require(navProvider.rate() > 0, "NAV Rate must be greater than 0");

        uint256 dsTokenAmount = calculateDsTokenAmount(_stableCoinAmount);
        require(dsTokenAmount >= _minOutAmount, "DSToken mount is lower than acceptable slippage");

        require(stableCoinToken.balanceOf(_msgSender()) >= _stableCoinAmount, "Not enough stable coin balance");

        _executeStableCoinTransfer(_msgSender(), _stableCoinAmount);
        assetProvider.supplyTo(_msgSender(), dsTokenAmount);

        emit Buy(_msgSender(), dsTokenAmount, _stableCoinAmount, navProvider.rate());
    }

    function executePreApprovedTransaction(
        bytes memory signature,
        string memory senderInvestor,
        address destination,
        address executor,
        bytes memory data,
        uint256[] memory params
    ) public override whenNotPaused {
        require(params.length == 2, "Incorrect params length");
        doExecuteByInvestor(signature, senderInvestor, destination, data, executor, params);
    }

    /**
     * @dev Update the NAV rate provider implementation.
     * @param _navProvider The NAV rate provider implementation address
     */
    function updateNavProvider(address _navProvider) public onlyOwner {
        require(_navProvider != address(0), "NAV provider cannot be zero address");
        navProvider = ISecuritizeNavProvider(_navProvider);
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
        require(signer != address(0), "Invalid signature");

        // Check that the recovered address is an issuer
        IDSTrustService trustService = IDSTrustService(dsServiceConsumer.getDSService(dsServiceConsumer.TRUST_SERVICE()));
        uint256 signerRole = trustService.getRole(signer);
        require(signerRole == trustService.ISSUER() || signerRole == trustService.MASTER(), "Insufficient trust level");
        noncePerInvestor[_senderInvestorId] = noncePerInvestor[_senderInvestorId] + 1;
        Address.functionCall(_destination, _data);
    }

    function calculateDsTokenAmount(uint256 _stableCoinAmount) public override view returns (uint256) {
        uint256 currentNavRate = navProvider.rate();
        return _stableCoinAmount * 10 ** IERC20Metadata(address(assetProvider.asset())).decimals() / currentNavRate;
    }

    function calculateStableCoinAmount(uint256 _dsTokenAmount) public override view returns (uint256) {
        return _dsTokenAmount * navProvider.rate() / (10 ** IERC20Metadata(address(assetProvider.asset())).decimals());
    }

    function updateAssetProvider(address _assetProvider) external onlyOwner {
        address oldProvider = address(assetProvider);
        assetProvider = IAssetProvider(_assetProvider);
        emit AssetProviderUpdated(oldProvider, _assetProvider);
    }

    function _executeStableCoinTransfer(address from, uint256 value) private {
        if (bridgeChainId != 0 && address(USDCBridge) != address(0)) {
            stableCoinToken.transferFrom(from, address(this), value);
            stableCoinToken.approve(address(USDCBridge), value);
            USDCBridge.sendUSDCCrossChainDeposit(bridgeChainId, custodianWallet, value);
        } else {
            stableCoinToken.transferFrom(from, custodianWallet, value);
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
