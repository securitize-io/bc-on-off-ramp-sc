/**
 * Copyright 2024 Securitize Inc. All rights reserved.
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
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";

/**
 * @title ILiquidityProvider
 */
interface ILiquidityProvider {
    /**
     * @dev Proxy Initializer.
     * @param _recipient wallet address that receives digital assets..
     * @param _liquidityToken liquidity token that the asset is being redeemed for.
     * @param _securitizeRedemption The address of the securitize redemption contract.
     **/
    function initialize(address _recipient, address _liquidityToken, address _securitizeRedemption) external;

    /**
     * @dev Supplies liquidity to a recipient
     * @param _redeemer Receiver of liquidity
     * @param _amount Amount of liquidity to transfer
     */
    function supplyTo(address _redeemer, uint256 _amount, uint256 _minOutputAmount) external;

    // GG: en IAssetProvider este se llama "asset: IDSToken"
    /**
     * @dev Returns the liquidity asset.
     * @return liquidity address.
     */
    function liquidityToken() external view returns (IERC20);

    /**
     * @dev The securitize off ramp contract.
     * @return The address of the securitize off ramp contract.
     */
    function securitizeOffRamp() external view returns (ISecuritizeOffRamp);

    /**
     * @dev Wallet address that receives digital assets.
     * @return Wallet address.
     */
    function recipient() external view returns (address);

    /**
     * @dev The available liquidity that can be supplied
     * @return The available liquidity amount
     */
    function availableLiquidity() external view returns (uint256);
}
