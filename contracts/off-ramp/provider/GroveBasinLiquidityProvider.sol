/**
 * Copyright 2026 Securitize Inc. All rights reserved.
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

import {BaseContract} from "../../common/BaseContract.sol";
import {IThirdPartyLiquidityProvider} from "./IThirdPartyLiquidityProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOffRamp} from "../IBaseOffRamp.sol";
import {IGroveBasin} from "../third-party-contracts/IGroveBasin.sol";

/**
 * @title GroveBasinLiquidityProvider
 * @notice Liquidity provider that, on each redemption, swaps the asset it just received
 *         (e.g. BUIDL) for the liquidity token (e.g. USDC) through Grove Basin (PSM3) at a
 *         strict 1:1 peg, forwarding the proceeds to the off-ramp in the same transaction.
 * @dev    `recipient()` resolves to this contract so the off-ramp two-step flow transfers the
 *         asset here right before calling {supplyTo}. The contract never holds asset nor
 *         liquidity token beyond the duration of a single redemption call.
 */
contract GroveBasinLiquidityProvider is IThirdPartyLiquidityProvider, BaseContract {
    using SafeERC20 for IERC20Metadata;

    /**
     * @dev Liquidity token delivered to the redeemer (stablecoin).
     */
    IERC20Metadata public liquidityToken;

    /**
     * @dev Asset token swapped into Grove Basin (e.g. BUIDL).
     */
    IERC20Metadata public assetToken;

    /**
     * @dev Off-ramp contract authorized to request liquidity.
     */
    IBaseOffRamp public securitizeOffRamp;

    /**
     * @dev Grove Basin (PSM3) contract used to perform the swap.
     */
    IGroveBasin public groveBasin;

    /**
     * @dev Wallet that receives the asset; resolves to this contract so it can be swapped.
     */
    address public recipient;

    /**
     * @dev Referral code forwarded to Grove Basin on each swap.
     */
    uint256 public referralCode;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error RedemptionUnauthorizedAccount(address account);

    /**
     * @dev Throws if called by any account other than the off-ramp contract.
     */
    modifier onlySecuritizeRedemption() {
        if (address(securitizeOffRamp) != _msgSender()) {
            revert RedemptionUnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IThirdPartyLiquidityProvider
     */
    function initialize(
        address _liquidityToken,
        address _securitizeOffRamp,
        address _groveBasin
    ) public onlyProxy initializer {
        if (_liquidityToken == address(0) || _securitizeOffRamp == address(0) || _groveBasin == address(0)) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        liquidityToken = IERC20Metadata(_liquidityToken);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
        groveBasin = IGroveBasin(_groveBasin);
        recipient = address(this);
        assetToken = IERC20Metadata(IBaseOffRamp(_securitizeOffRamp).assetAddress());
    }

    /**
     * @notice Sets a new Grove Basin contract address.
     * @param _groveBasin New Grove Basin (PSM3) address.
     */
    function setGroveBasin(address _groveBasin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_groveBasin == address(0)) {
            revert NonZeroAddressError();
        }
        emit GroveBasinUpdated(address(groveBasin), _groveBasin);
        groveBasin = IGroveBasin(_groveBasin);
    }

    /**
     * @notice Sets the referral code forwarded to Grove Basin on each swap.
     * @param _referralCode New referral code.
     */
    function setReferralCode(uint256 _referralCode) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ReferralCodeUpdated(referralCode, _referralCode);
        referralCode = _referralCode;
    }

    /**
     * @notice Returns the currently available liquidity.
     * @return Available liquidity amount.
     */
    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    /**
     * @dev Best-effort available liquidity held by Grove Basin for the liquidity token.
     *      The hard guarantee is enforced by Grove Basin reverting the swap when the pool
     *      cannot satisfy the requested output.
     * @return Liquidity token balance available in Grove Basin.
     */
    function _availableLiquidity() private view returns (uint256) {
        //TODO: Check if we need to return from groveBasin
        return liquidityToken.balanceOf(address(groveBasin));
    }

    /**
     * @notice Swaps the asset held by this contract for liquidity token through Grove Basin.
     * @dev Called by the off-ramp two-step flow after the asset has been transferred here.
     *      `_minOut` is the NAV-derived expected output and is used as the swap floor; it must
     *      never be zero so the strict 1:1 peg is enforced on-chain.
     * @param _receiver Recipient of the liquidity token (the off-ramp contract).
     * @param _minOut Minimum amount of liquidity token to receive from the swap.
     * @return amountOut Liquidity token amount delivered by Grove Basin.
     */
    function supplyTo(
        address _receiver,
        uint256 _minOut
    ) public whenNotPaused onlySecuritizeRedemption returns (uint256 amountOut) {
        IERC20Metadata _assetToken = assetToken;
        uint256 amountIn = _assetToken.balanceOf(address(this));
        if (amountIn == 0) {
            revert ZeroAmountToSwap();
        }

        uint256 available = _availableLiquidity();
        if (_minOut > available) {
            revert InsufficientLiquidity(_minOut, available);
        }

        IGroveBasin _groveBasin = groveBasin;
        _assetToken.forceApprove(address(_groveBasin), amountIn);

        amountOut = _groveBasin.swapExactIn(
            address(_assetToken),
            address(liquidityToken),
            amountIn,
            _minOut,
            _receiver,
            referralCode
        );
    }

    /**
     * @notice Calculates the effective liquidity token amount for a given input amount.
     * @dev Grove Basin enforces a strict 1:1 peg, so the effective amount equals the input.
     * @param _initialLiquidityAmount The initial liquidity amount.
     * @return amountToSupply The effective liquidity token amount to supply.
     */
    function calculateEffectiveLiquidityTokenAmount(
        uint256 _initialLiquidityAmount
    ) external pure returns (uint256 amountToSupply) {
        return _initialLiquidityAmount;
    }
}
