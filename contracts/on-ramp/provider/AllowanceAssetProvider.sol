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
pragma solidity 0.8.22;

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {BaseContract} from "../../common/BaseContract.sol";
import {IAllowanceAssetProvider} from "./IAllowanceAssetProvider.sol";
import {IBaseOnRamp} from "../IBaseOnRamp.sol";

/**
 * @title AllowanceAssetProvider
 */
contract AllowanceAssetProvider is IAllowanceAssetProvider, BaseContract {
    /**
     * @dev asset.
     */
    IDSToken public asset;

    /**
     * @dev securitize on ramp contract.
     */
    IBaseOnRamp public securitizeOnRamp;

    /**
     * @dev asset provider wallet.
     */
    address public assetProviderWallet;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error UnauthorizedAccount(address account);

    /**
     * @dev Throws if called by any account other than the on ramp contract.
     */
    modifier onlySecuritizeOnRamp() {
        if (address(securitizeOnRamp) != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Proxy Initializer.
     * @param _asset securitize rwa
     * @param _securitizeOnRamp The address of the securitize on ramp contract.
     * @param _assetProviderWallet asset supplier address
     **/
    function initialize(
        address _asset,
        address _securitizeOnRamp,
        address _assetProviderWallet
    ) public onlyProxy initializer {
        if (_asset == address(0)) {
            revert NonZeroAddressError();
        }
        if (_securitizeOnRamp == address(0)) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        asset = IDSToken(_asset);
        securitizeOnRamp = IBaseOnRamp(_securitizeOnRamp);
        assetProviderWallet = _assetProviderWallet;
    }

    function setAllowanceProviderWallet(address _assetProviderWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_assetProviderWallet == address(0)) {
            revert NonZeroAddressError();
        }
        emit AllowanceAssetProviderWalletUpdated(assetProviderWallet, _assetProviderWallet);
        assetProviderWallet = _assetProviderWallet;
    }

    function supplyTo(address _buyer, uint256 _amount) public whenNotPaused onlySecuritizeOnRamp {
        //transfer assets from provider wallet to buyer
        asset.transferFrom(assetProviderWallet, _buyer, _amount);
    }
}
