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

import {BaseExternalGroveBasinProvider} from "../../common/BaseExternalGroveBasinProvider.sol";
import {IExternalAssetProvider} from "./IExternalAssetProvider.sol";
import {IDSToken} from "@securitize/digital_securities/contracts/token/IDSToken.sol";
import {ISecuritizeNavProvider} from "@securitize/digital_securities/contracts/nav/ISecuritizeNavProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOnRamp} from "../IBaseOnRamp.sol";
import {IGroveBasin} from "../../off-ramp/third-party-contracts/IGroveBasin.sol";

/**
 * @title ExternalAssetProvider
 * @notice Asset provider that, on each subscription, swaps the liquidity token (e.g. USDC) it just
 *         received from the on-ramp for the asset (e.g. BUIDL) through an external liquidity provider like Grove Basin
 *         (PSM3), delivering the exact NAV asset amount the on-ramp expects.
 * @dev    The on-ramp settles the net liquidity (after fee) on this contract right before calling
 *         {supplyTo} by being deployed with `custodianWallet == address(this)`. The contract holds
 *         no liquidity-token treasury: the swap is sized so the whole on-hand balance is consumed,
 *         and any residual reverts the call ({LiquidityNotFullyConsumed}).
 *
 *         The swap uses {IGroveBasin.swapExactOut} (exact asset out) so the provider delivers
 *         exactly the NAV `dsTokenAmount`. This is required by the on-ramp two-step flow, which
 *         forwards a fixed amount to the investor — see {BaseOnRamp._executeAssetTransfer}. It also
 *         keeps single-step deliveries exact.
 *
 *         All NAV math is computed internally from {navProvider} (which must match the on-ramp's NAV
 *         provider); the provider never calls back into the on-ramp. The shared Grove Basin handle,
 *         referral code and tolerance live in {BaseExternalGroveBasinProvider}. Token wiring mirrors
 *         the off-ramp: {liquidityToken} is Grove Basin's `collateralToken` and {asset} is its
 *         `creditToken`.
 */
contract ExternalAssetProvider is IExternalAssetProvider, BaseExternalGroveBasinProvider {
    using SafeERC20 for IERC20Metadata;

    /**
     * @dev Liquidity token (stablecoin) supplied by the investor and swapped into Grove Basin.
     */
    IERC20Metadata public liquidityToken;

    /**
     * @dev Asset (DSToken) delivered to the investor.
     */
    IDSToken public asset;

    /**
     * @dev On-ramp contract authorized to request assets.
     */
    IBaseOnRamp public securitizeOnRamp;

    /**
     * @dev Securitize NAV provider used to price the swap (must match the on-ramp's NAV provider).
     */
    ISecuritizeNavProvider public navProvider;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error UnauthorizedAccount(address account);

    /**
     * @dev Throws if called by any account other than the on-ramp contract.
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
     * @inheritdoc IExternalAssetProvider
     */
    function initialize(
        address _liquidityToken,
        address _asset,
        address _navProvider,
        address _groveBasin
    ) public onlyProxy initializer {
        if (
            _liquidityToken == address(0) ||
            _asset == address(0) ||
            _navProvider == address(0) ||
            _groveBasin == address(0)
        ) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        liquidityToken = IERC20Metadata(_liquidityToken);
        asset = IDSToken(_asset);
        navProvider = ISecuritizeNavProvider(_navProvider);
        __BaseExternalGroveBasinProvider_init(_groveBasin);
    }

    /**
     * @inheritdoc IExternalAssetProvider
     */
    function setSecuritizeOnRamp(address _securitizeOnRamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_securitizeOnRamp == address(0)) {
            revert NonZeroAddressError();
        }
        emit SecuritizeOnRampUpdated(address(securitizeOnRamp), _securitizeOnRamp);
        securitizeOnRamp = IBaseOnRamp(_securitizeOnRamp);
    }

    /**
     * @notice Swaps the liquidity token held by this contract for the asset through Grove Basin.
     * @dev Called by the on-ramp after the net liquidity has been settled on this contract
     *      (`custodianWallet == address(this)`). The swap is bound to the current subscription:
     *      the asset amount derived from the on-hand liquidity must equal the amount the on-ramp
     *      expects, otherwise it reverts with {UnexpectedLiquidityBalanceError} so donated/stuck
     *      liquidity is not swept into the caller's purchase.
     *
     *      It then compares the Securitize NAV quote with the Grove Basin {previewSwapExactOut}
     *      before spending swap gas, and executes {swapExactOut} for the exact expected asset
     *      amount. `maxAmountIn` is the whole on-hand balance and the call reverts if any liquidity
     *      is left unspent, so the provider never retains a treasury.
     * @param _buyer Recipient of the asset (the investor in single-step, the on-ramp in two-step).
     * @param _expectedAssetAmount Asset amount (before fee) the on-ramp expects for this subscription.
     */
    function supplyTo(address _buyer, uint256 _expectedAssetAmount) public whenNotPaused onlySecuritizeOnRamp {
        uint256 balance = liquidityToken.balanceOf(address(this));
        if (balance == 0) {
            revert ZeroAmountToSwap();
        }

        // Bind the swap to the liquidity delivered by THIS subscription. A mismatch means the
        // on-hand balance includes liquidity that does not belong to the current subscription;
        // reject instead of sweeping it (which would deliver asset the buyer did not pay for).
        uint256 navAsset = _assetForLiquidity(balance);
        if (navAsset != _expectedAssetAmount) {
            revert UnexpectedLiquidityBalanceError(_expectedAssetAmount, navAsset);
        }

        uint256 available = availableAsset();
        if (_expectedAssetAmount > available) {
            revert InsufficientAssetLiquidity(_expectedAssetAmount, available);
        }

        // Grove Basin's required input for the exact asset output, validated against the NAV-implied
        // input (the on-hand balance) before spending swap gas.
        uint256 gbAmountIn = externalProvider.previewSwapExactOut(address(liquidityToken), address(asset), _expectedAssetAmount);
        _validateRateBand(balance, gbAmountIn);

        liquidityToken.forceApprove(address(externalProvider), balance);

        externalProvider.swapExactOut(
            address(liquidityToken),
            address(asset),
            _expectedAssetAmount,
            balance,
            _buyer,
            referralCode
        );

        // No treasury: the exact-out swap must have consumed the whole balance. Any residual rolls
        // the transaction back rather than sitting on the provider.
        uint256 leftover = liquidityToken.balanceOf(address(this));
        if (leftover != 0) {
            liquidityToken.forceApprove(address(externalProvider), 0);
            revert LiquidityNotFullyConsumed(leftover);
        }
    }

    /**
     * @notice Returns the asset amount available for purchases in Grove Basin.
     * @dev Reads the asset balance at the Grove Basin asset custodian. In this integration the
     *      asset is Grove Basin's `creditToken`, held by the Grove Basin contract itself.
     * @return The asset amount available at the Grove Basin asset custodian.
     */
    function availableAsset() public view returns (uint256) {
        return asset.balanceOf(_custodianOf(address(asset)));
    }

    /**
     * @dev Converts a net liquidity amount (already excluding fees) into the asset amount at the
     *      current NAV rate, without applying any fee. Mirrors the on-ramp's NAV math so the
     *      subscription binding matches exactly. Reverts when the NAV rate is zero.
     * @param _liquidityAmount Net liquidity amount (after fees) to convert.
     * @return assetAmount Asset amount for the given net liquidity at the current NAV rate.
     */
    function _assetForLiquidity(uint256 _liquidityAmount) private view returns (uint256 assetAmount) {
        uint256 rate = navProvider.rate();
        if (rate == 0) {
            revert NonZeroNavRateError();
        }
        uint8 liquidityTokenDecimals = liquidityToken.decimals();
        uint8 assetDecimals = IERC20Metadata(address(asset)).decimals();
        assetAmount = (_liquidityAmount * (10 ** (2 * assetDecimals))) / (rate * (10 ** liquidityTokenDecimals));
    }

    /**
     * @inheritdoc BaseExternalGroveBasinProvider
     */
    function _expectedCollateralToken() internal view override returns (address) {
        return address(liquidityToken);
    }

    /**
     * @inheritdoc BaseExternalGroveBasinProvider
     */
    function _expectedCreditToken() internal view override returns (address) {
        return address(asset);
    }
}
