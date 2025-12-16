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

import {IBaseOnRamp} from "./IBaseOnRamp.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IFeeManager} from "../fee/IFeeManager.sol";
import {IAssetProvider} from "./provider/IAssetProvider.sol";
import {IDSRegistryService} from "@securitize/digital_securities/contracts/registry/IDSRegistryService.sol";
import {IDSTrustService} from "@securitize/digital_securities/contracts/trust/IDSTrustService.sol";
import {IDSServiceConsumer} from "@securitize/digital_securities/contracts/service/IDSServiceConsumer.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUSDCBridge} from "./cttp/IUSDCBridge.sol";
import {BaseOnOffRamp} from "../common/BaseOnOffRamp.sol";

abstract contract BaseOnRamp is IBaseOnRamp, BaseOnOffRamp {

    // init params
    IDSServiceConsumer public dsToken;
    IERC20Metadata public liquidityToken;
    IAssetProvider public assetProvider;
    IFeeManager public feeManager;
    address public custodianWallet;

    // adhoc configuration variables
    uint256 public minSubscriptionAmount;
    bool public investorSubscriptionEnabled;
    IUSDCBridge public USDCBridge;
    uint16 public bridgeChainId;

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

    modifier investorExists(address _investorWallet) {
        IDSRegistryService registryService = IDSRegistryService(dsToken.getDSService(dsToken.REGISTRY_SERVICE()));
        if (!registryService.isWallet(_investorWallet)) {
            revert InvestorNotRegisteredError();
        }
        _;
    }

    function __BaseOnRamp_init(string memory name, string memory version) internal onlyInitializing {
        __BaseOnOffRamp_init(name, version);
    }

    function _swap(uint256 _liquidityAmount, uint256 _dsTokenAmount, uint256 _minOutAmount, address _investorWallet) internal {
        if (_dsTokenAmount < _minOutAmount) {
            revert SlippageControlError();
        }

        _executeLiquidityTransfer(_investorWallet, _liquidityAmount);
        _executeAssetTransfer(_investorWallet, _dsTokenAmount);
    }

    function updateAssetProvider(address _assetProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_assetProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit AssetProviderUpdated(address(assetProvider), _assetProvider);
        assetProvider = IAssetProvider(_assetProvider);
    }

    function updateMinSubscriptionAmount(uint256 _minSubscriptionAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MinSubscriptionAmountUpdated(minSubscriptionAmount, _minSubscriptionAmount);
        minSubscriptionAmount = _minSubscriptionAmount;
    }

    function updateBridgeParams(uint16 _chainId, address _bridge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridgeChainId = _chainId;
        USDCBridge = IUSDCBridge(_bridge);
        emit BridgeParamsUpdated(_chainId, _bridge);
    }

    function toggleInvestorSubscription(bool _investorSubscription) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_investorSubscription == investorSubscriptionEnabled) {
            revert SameValueError();
        }
        investorSubscriptionEnabled = _investorSubscription;
        emit InvestorSubscriptionUpdated(_investorSubscriptionEnabled);
    }

    function _executeLiquidityTransfer(address from, uint256 amount) internal {
        IERC20Metadata _liquidityToken = liquidityToken;
        if (_liquidityToken.balanceOf(from) < amount) {
            revert InsufficientERC20BalanceError();
        }

        _liquidityToken.transferFrom(from, address(this), amount);
        IFeeManager _feeManager = feeManager;
        uint256 fee = _feeManager.getFee(amount);
        if (fee > 0) {
            _liquidityToken.transfer(_feeManager.feeCollector(), fee);
        }

        uint256 amountExcludingFee = amount - fee;
        uint16 _bridgeChainId = bridgeChainId;
        IUSDCBridge _USDCBridge = USDCBridge;
        bool bridgeTransfer = _bridgeChainId != 0 && address(_USDCBridge) != address(0);
        if (bridgeTransfer) {
            _liquidityToken.approve(address(_USDCBridge), amountExcludingFee);
            _USDCBridge.sendUSDCCrossChainDeposit(_bridgeChainId, custodianWallet, amountExcludingFee);
        } else {
            _liquidityToken.transfer(custodianWallet, amountExcludingFee);
        }
    }

    function _executeAssetTransfer(address to, uint256 amount) internal {
        if (twoStepTransfer) {
            assetProvider.supplyTo(address(this), amount);
            IERC20Metadata(address(dsToken)).transfer(to, amount);
        } else {
            assetProvider.supplyTo(to, amount);
        }
    }
}
