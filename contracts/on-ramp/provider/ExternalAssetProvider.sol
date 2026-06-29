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
 *         no liquidity-token treasury: the swap spends the whole on-hand balance via
 *         {IGroveBasin.swapExactIn}, so nothing is left behind.
 *
 *         The swap uses {IGroveBasin.swapExactIn} (exact liquidity in) on the full on-hand balance,
 *         and the asset amount Grove Basin would deliver must equal the NAV `dsTokenAmount` exactly
 *         (strict 1:1). The provider previews the swap with {IGroveBasin.previewSwapExactIn} and
 *         reverts with {UnexpectedSwapOutputError} on any divergence. This exactness is required by
 *         the on-ramp two-step flow, which forwards a fixed amount to the investor — see
 *         {BaseOnRamp._executeAssetTransfer} — and keeps single-step deliveries exact too.
 *
 *         Because exactness is enforced, the inherited NAV-divergence tolerance band
 *         ({redeemTolerance}) is intentionally not applied here; an exact quote is stricter than any
 *         non-zero band. Operating against a real Grove Basin therefore requires a swap with no fee
 *         and an oracle that prices the asset exactly at NAV (see the integration guide).
 *
 *         All NAV math is computed internally from {navProvider} (which must match the on-ramp's NAV
 *         provider); the provider never calls back into the on-ramp. The shared Grove Basin handle
 *         and referral code live in {BaseExternalGroveBasinProvider}. Token wiring mirrors the
 *         off-ramp: {liquidityToken} is Grove Basin's `collateralToken` and {asset} is its
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
     *      It then previews swapping the whole on-hand balance through Grove Basin with
     *      {previewSwapExactIn}. Because the on-ramp two-step flow forwards a fixed asset amount, the
     *      quote must equal `_expectedAssetAmount` exactly; any divergence reverts with
     *      {UnexpectedSwapOutputError}. It finally executes {swapExactIn} for the whole balance with
     *      `minAmountOut == _expectedAssetAmount` as Grove Basin's native floor, so the swap reverts
     *      rather than delivering less than expected.
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

        // Asset amount Grove Basin would deliver for the whole on-hand balance. The two-step on-ramp
        // forwards a fixed amount, so this must match the expected asset amount exactly: reject any
        // divergence (a Grove Basin fee or oracle drift) rather than under-delivering or stranding
        // surplus on the on-ramp.
        uint256 gbAmountOut = externalProvider.previewSwapExactIn(address(liquidityToken), address(asset), balance);
        if (gbAmountOut != _expectedAssetAmount) {
            revert UnexpectedSwapOutputError(_expectedAssetAmount, gbAmountOut);
        }

        liquidityToken.forceApprove(address(externalProvider), balance);

        externalProvider.swapExactIn(
            address(liquidityToken),
            address(asset),
            balance,
            _expectedAssetAmount,
            _buyer,
            referralCode
        );
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
