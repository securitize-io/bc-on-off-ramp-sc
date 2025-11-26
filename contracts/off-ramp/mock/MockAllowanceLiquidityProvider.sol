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

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRegularOffRamp} from "../IRegularOffRamp.sol";

contract MockAllowanceLiquidityProvider {
    IERC20 public liquidityToken;
    address public recipient;
    IRegularOffRamp public securitizeOffRamp;

    /**
     * @dev Mock constructor wiring token, recipient, and off-ramp.
     * @param _liquidityToken Mock liquidity token address.
     * @param _recipient Recipient wallet.
     * @param _securitizeOffRamp Off-ramp contract address.
     */
    constructor(address _liquidityToken, address _recipient, address _securitizeOffRamp) {
        liquidityToken = IERC20(_liquidityToken);
        recipient = _recipient;
        securitizeOffRamp = IRegularOffRamp(_securitizeOffRamp);
    }
}
