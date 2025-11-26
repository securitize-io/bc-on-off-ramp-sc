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

import {IRegularOffRamp} from "./IRegularOffRamp.sol";
import {BaseOffRamp} from "./BaseOffRamp.sol";

contract RegularOffRamp is IRegularOffRamp, BaseOffRamp {

    string public constant NAME = "SecuritizeOffRamp";
    string public constant VERSION = "1";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes RegularOffRamp implementation.
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
     * @notice Redeems asset tokens for liquidity tokens using on-chain NAV rate.
     * @param _assetAmount Asset amount to redeem.
     * @param _minOutputAmount Minimum liquidity tokens expected (slippage guard).
     */
    function redeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount
    )
        public
        override
        whenNotPaused
        nonZeroNavRate
    {
        uint256 rate = navProvider.rate();
        (uint256 fee, uint256 liquidityValue) = _redeem(_assetAmount, _minOutputAmount, rate, _msgSender());

        emit RedemptionCompleted(
            _msgSender(),
            _assetAmount,
            liquidityValue,
            rate,
            fee,
            address(liquidityProvider.liquidityToken())
        );
    }
}
