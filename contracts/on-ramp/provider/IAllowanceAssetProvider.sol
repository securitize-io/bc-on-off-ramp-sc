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

import {IAssetProvider} from "./IAssetProvider.sol";

/**
 * @title IAllowanceAssetProvider
 */
interface IAllowanceAssetProvider is IAssetProvider {
    /**
     * @dev Emitted when owner updates asset Provider address.
     * @param oldProvider Old allowance asset provider address
     * @param newProvider New allowance asset provider address
     */
    event AllowanceAssetProviderWalletUpdated(address oldProvider, address newProvider);

    /**
     * @dev Set provider wallet.
     * @param _assetProviderWallet The address of the wallet that provides assets.
     */
    function setAllowanceProviderWallet(address _assetProviderWallet) external;
}
