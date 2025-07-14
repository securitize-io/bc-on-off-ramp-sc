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

import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityProvider} from "../provider/ILiquidityProvider.sol";

contract MockExternalRedemption {
    IDSToken public asset;
    ILiquidityProvider public liquidityProvider;
    IERC20 private liquidityToken;
    uint256 public constant FEE_DENOMINATOR = 100_000;
    uint256 public fee;

    constructor(address _mockAsset, address _liquidityToken, uint256 _fee) {
        asset = IDSToken(_mockAsset);
        liquidityToken = IERC20(_liquidityToken);
        fee = _fee;
    }

    function _getFee(uint256 amount) private view returns (uint256) {
        if (fee == 0) return 0;
        return (amount * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
    }

    // rate 1:1 without fees
    function redeem(uint256 amount, uint256) external {
        uint256 fee_ = _getFee(amount);
        IDSToken(asset).transferFrom(msg.sender, address(this), amount);
        IERC20(liquidityToken).transfer(msg.sender, amount - fee_);
    }

    function updateLiquidityProvider(address _liquidityProvider) external {
        liquidityProvider = ILiquidityProvider(_liquidityProvider);
    }

    function calculateLiquidityTokenAmount(uint256 amount) external view returns (uint256) {
        uint256 fee_ = _getFee(amount);
        uint256 amountToSupply = amount - fee_;
        return amountToSupply;
    }
}
