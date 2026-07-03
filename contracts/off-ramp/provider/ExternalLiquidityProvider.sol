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

import {BaseExternalProvider} from "../../common/BaseExternalProvider.sol";
import {IExternalLiquidityProvider} from "./IExternalLiquidityProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOffRamp} from "../IBaseOffRamp.sol";
import {BaseOnOffRamp} from "../../common/BaseOnOffRamp.sol";
import {ISecuritizeOffRamp} from "../ISecuritizeOffRamp.sol";
import {IGroveBasin} from "../third-party-contracts/IGroveBasin.sol";

/**
 * @title ExternalLiquidityProvider
 * @notice Liquidity provider that, on each redemption, swaps the asset it just received
 *         (e.g. BUIDL) for the liquidity token (e.g. USDC) through Grove Basin (PSM3),
 *         forwarding the proceeds to the off-ramp in the same transaction.
 * @dev    `recipient()` resolves to this contract so the off-ramp two-step flow transfers the
 *         asset here right before calling {supplyExactIn}. The swap is bound to the redemption's own
 *         asset amount (not the on-hand balance), so a stray asset donation is neither swept into the
 *         redemption nor able to revert it; any surplus stays on the provider and is recoverable via
 *         {rescueTokens}. The balance-based {supplyTo} entrypoint is disabled
 *         ({DirectSupplyNotSupported}).
 *
 *         {supplyExactIn} reverts with {TwoStepTransferRequired} unless the linked off-ramp has
 *         two-step transfer enabled. Single-step redemptions are unsupported because the asset must
 *         be transferred here before the swap.
 *
 *         {supplyExactIn} also reverts with {AssetBurnNotSupported} when the linked off-ramp has
 *         asset burning enabled, because the asset must be transferred here before the swap.
 *
 *         Before executing the Grove Basin swap, the provider compares the Securitize NAV quote
 *         with the Grove Basin preview quote and reverts when they diverge beyond {rateTolerance}.
 *         The NAV side of that check is pre-fee while the Grove Basin preview is net of Grove Basin's
 *         redemption fee, so admins MUST keep {rateTolerance} at or above the expected Grove Basin fee
 *         plus a margin (see {BaseExternalProvider.rateTolerance}); otherwise a Grove Basin fee near
 *         the band reverts legitimate redemptions with {MinRateDivergenceError}.
 *
 *         The shared Grove Basin handle, referral code and tolerance live in
 *         {BaseExternalProvider}.
 */
contract ExternalLiquidityProvider is IExternalLiquidityProvider, BaseExternalProvider {
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
     * @dev Wallet that receives the asset; resolves to this contract so it can be swapped.
     */
    address public recipient;

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

    /**
     * @dev Requires the linked off-ramp to operate in two-step transfer mode.
     */
    modifier onlyTwoStepTransfer() {
        if (!BaseOnOffRamp(address(securitizeOffRamp)).twoStepTransfer()) {
            revert TwoStepTransferRequired();
        }
        _;
    }

    /**
     * @dev Requires the linked off-ramp to keep redeemed assets instead of burning them.
     */
    modifier onlyWithoutAssetBurn() {
        if (securitizeOffRamp.assetBurn()) {
            revert AssetBurnNotSupported();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IExternalLiquidityProvider
     */
    function initialize(
        address _liquidityToken,
        address _securitizeOffRamp,
        address _externalProvider
    ) public onlyProxy initializer {
        if (_liquidityToken == address(0) || _securitizeOffRamp == address(0) || _externalProvider == address(0)) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        liquidityToken = IERC20Metadata(_liquidityToken);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
        assetToken = IERC20Metadata(IBaseOffRamp(_securitizeOffRamp).assetAddress());
        __BaseExternalProvider_init(_externalProvider);
        recipient = address(this);
    }

    /**
     * @notice Rotates the off-ramp authorized to request liquidity from this provider.
     * @dev The provider stores the off-ramp both at init and here so the authorized caller can be
     *      rotated without a UUPS upgrade. It is asymmetric with the on-ramp side by design: the
     *      companion {ExternalAssetProvider} is deployed BEFORE its on-ramp (the on-ramp is initialized
     *      with `custodianWallet == provider`), so it can only wire the on-ramp post-init via a setter;
     *      here the off-ramp is deployed FIRST (this provider derives {assetToken} from it at init), so
     *      the off-ramp is available at init and the setter exists purely for later rotation.
     *
     *      {assetToken} is frozen at init, so the new off-ramp must redeem that same asset; otherwise
     *      the swap wiring would reference a stale asset. The mismatch is rejected with {AssetMismatch}.
     *      Rotation thus supports replacing the off-ramp for the same asset (e.g. an off-ramp redeploy),
     *      not switching the asset.
     *
     *      Only the provider -> off-ramp link is updated here. The new off-ramp must also point back to
     *      this provider via {IBaseOffRamp.updateLiquidityProvider}; until both directions are wired,
     *      redemptions revert.
     * @param _securitizeOffRamp New off-ramp authorized to request liquidity.
     */
    function setSecuritizeOffRamp(address _securitizeOffRamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_securitizeOffRamp == address(0)) {
            revert NonZeroAddressError();
        }
        address newOffRampAsset = IBaseOffRamp(_securitizeOffRamp).assetAddress();
        if (newOffRampAsset != address(assetToken)) {
            revert AssetMismatch(address(assetToken), newOffRampAsset);
        }
        emit SecuritizeOffRampUpdated(address(securitizeOffRamp), _securitizeOffRamp);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
    }

    /**
     * @notice Returns the wallet that custodies the liquidity token swapable in Grove Basin.
     * @dev Mirrors Grove Basin's own custody model (see {GroveBasin._getAssetCustodian}): the
     *      `pocket` only custodies the `swapToken`, while the `collateralToken` and `creditToken`
     *      are held by the Grove Basin contract itself.
     *
     *      In this integration the liquidity token is wired as Grove Basin's `collateralToken`
     *      (the RWA asset is the `creditToken` swapped in during redemption), so the custodian
     *      resolves to the Grove Basin contract regardless of whether an external pocket is
     *      configured for `swapToken` yield deployment. The `pocket` branch is kept for the case
     *      where the liquidity token is instead configured as Grove Basin's `swapToken`.
     *
     *      To query available liquidity, read the ERC-20 balance of the liquidity token at the
     *      address returned by this function: `liquidityToken.balanceOf(getLiquidityCustodian())`.
     * @return custodian Wallet whose liquidity-token balance reflects swapable liquidity in Grove Basin.
     */
    function getLiquidityCustodian() public view returns (address custodian) {
        return _custodianOf(address(liquidityToken));
    }

    /**
     * @notice Returns a best-effort upper bound on the currently available liquidity.
     * @dev Reads the raw liquidity-token balance at {getLiquidityCustodian} (see {_availableLiquidity}).
     *      This is an UPPER BOUND, not exact deliverable capacity: it does NOT net out portions Grove
     *      Basin may treat as non-deliverable (e.g. seed deposit, fee-claimer accrual, or collateral
     *      reserved against pending redemptions). Off-chain integrators sizing batches from this view
     *      should treat it as an optimistic ceiling; the hard guarantee is enforced on-chain by Grove
     *      Basin reverting the swap when the pool cannot satisfy the requested output.
     * @return A best-effort upper bound on the available liquidity amount.
     */
    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity();
    }

    /**
     * @notice Disabled balance-based entrypoint; use {supplyExactIn}.
     * @dev The external Grove Basin provider binds each swap to the redemption's own asset amount via
     *      {supplyExactIn} so a token donation cannot change the swapped amount. The companion
     *      {ExternalLiquidityProviderOffRamp} always drives the provider through {supplyExactIn}; this
     *      balance-based entrypoint is intentionally disabled and reverts with
     *      {DirectSupplyNotSupported}.
     *
     *      The configuration guards are kept ahead of the disable so a misconfigured pairing (e.g. a
     *      base off-ramp in single-step or with asset burning) still surfaces the precise
     *      {TwoStepTransferRequired}/{AssetBurnNotSupported} diagnostic instead of the generic revert.
     */
    function supplyTo(
        address,
        uint256
    )
        public
        view
        whenNotPaused
        onlySecuritizeRedemption
        onlyTwoStepTransfer
        onlyWithoutAssetBurn
        returns (uint256)
    {
        revert DirectSupplyNotSupported();
    }

    /**
     * @notice Swaps exactly `_assetAmount` of the asset held by this contract for liquidity token
     *         through Grove Basin.
     * @dev Called by the off-ramp two-step flow after the redeemed asset has been transferred here.
     *      Reverts with {AssetBurnNotSupported} when the linked off-ramp burns redeemed assets,
     *      because this provider must receive the asset before swapping it through Grove Basin.
     *
     *      The swap is bound to `_assetAmount` (the amount this redemption transferred) rather than
     *      the whole on-hand balance, so a stray asset donation neither changes the swapped amount nor
     *      reverts the redemption; any surplus stays on the provider and is recoverable via
     *      {rescueTokens}. The off-ramp forwards the NAV gross it expects for `_assetAmount`; this
     *      function re-derives it from the same amount and reverts with {UnexpectedAssetBalanceError}
     *      on an inconsistent NAV state.
     *
     *      Afterwards it compares the Securitize NAV quote with the Grove Basin preview before
     *      spending swap gas. The swap floor is set to the Grove Basin preview so Basin's native
     *      slippage protection is enforced as a second line of defense.
     *
     *      Liquidity sufficiency is delegated entirely to Grove Basin: it reverts the swap when the
     *      pool (including any pocket-backed collateral top-up) cannot deliver the requested output.
     *      No local balance-based availability gate is applied, because reading only the liquidity
     *      token held directly by Grove Basin understates the deliverable amount for the
     *      `collateralToken` wiring used here.
     * @param _receiver Recipient of the liquidity token (the off-ramp contract).
     * @param _assetAmount Asset amount redeemed in this operation, to be swapped through Grove Basin.
     * @param _expectedLiquidityAmount NAV gross (before fee) the off-ramp expects for this redemption.
     * @return amountOut Liquidity token amount delivered by Grove Basin.
     */
    function supplyExactIn(
        address _receiver,
        uint256 _assetAmount,
        uint256 _expectedLiquidityAmount
    )
        public
        whenNotPaused
        onlySecuritizeRedemption
        onlyTwoStepTransfer
        onlyWithoutAssetBurn
        returns (uint256 amountOut)
    {
        if (_assetAmount == 0) {
            revert ZeroAmountToSwap();
        }

        IERC20Metadata _assetToken = assetToken;
        uint256 balance = _assetToken.balanceOf(address(this));
        if (balance < _assetAmount) {
            revert InsufficientAssetToSwap(_assetAmount, balance);
        }

        IGroveBasin _externalProvider = externalProvider;

        uint256 navGross = ISecuritizeOffRamp(address(securitizeOffRamp)).calculateLiquidityTokenAmountBeforeFee(
            _assetAmount
        );

        // Bind the swap to the asset delivered by THIS redemption. A mismatch signals an inconsistent
        // NAV state between the off-ramp quote and the swap; reject instead of paying an amount the
        // redeemer did not agree to. Binding to `_assetAmount` (not the balance) means a donation is
        // ignored by the swap.
        if (navGross != _expectedLiquidityAmount) {
            revert UnexpectedAssetBalanceError(_expectedLiquidityAmount, navGross);
        }

        uint256 gbPreview = _externalProvider.previewSwapExactIn(address(_assetToken), address(liquidityToken), _assetAmount);

        // Reject dust-sized redemptions whose NAV or Grove Basin quote floors to zero. A zero preview
        // would be forwarded as Grove Basin's `minAmountOut`, silently removing the swap floor
        // (`amountOut < 0` never holds), and a zero NAV would collapse the tolerance band to (0,0).
        // Rejecting here keeps the documented price floor intact for every accepted redemption.
        if (gbPreview == 0 || navGross == 0) {
            revert ZeroAmountToSwap();
        }

        _validateRateBand(navGross, gbPreview);

        // No local availability gate: reading only the liquidity-token balance directly held by Grove
        // Basin ({_availableLiquidity}) is stricter than Grove Basin's actual execution. For the
        // `collateralToken` output used here, Grove Basin tops up any Basin-side deficit from its
        // configured pocket (see {GroveBasin._withdrawLiquidityInPocket}), so a balance-based precheck
        // would wrongly revert redemptions that Grove Basin can satisfy. The hard liquidity guarantee is
        // Grove Basin itself, which reverts the swap ({InsufficientFunds}) when the pool plus pocket
        // cannot deliver `gbPreview`. {availableLiquidity} remains as a best-effort off-chain UX read.
        _assetToken.forceApprove(address(_externalProvider), _assetAmount);

        amountOut = _externalProvider.swapExactIn(
            address(_assetToken),
            address(liquidityToken),
            _assetAmount,
            gbPreview,
            _receiver,
            referralCode
        );
    }

    /**
     * @notice Calculates the effective liquidity token amount for a given input amount.
     * @dev Identity by design: a Grove-accurate quote (rate + fee) is produced by
     *      {ExternalLiquidityProviderOffRamp.calculateLiquidityTokenAmount} via
     *      {IGroveBasin.previewSwapExactIn}, so this hook leaves the NAV gross unchanged.
     * @param _initialLiquidityAmount The initial liquidity amount.
     * @return amountToSupply The effective liquidity token amount to supply.
     */
    function calculateEffectiveLiquidityTokenAmount(
        uint256 _initialLiquidityAmount
    ) external pure returns (uint256 amountToSupply) {
        return _initialLiquidityAmount;
    }

    /**
     * @dev Best-effort available liquidity held by Grove Basin for the liquidity token.
     *      Reads the liquidity-token balance at {getLiquidityCustodian} (the Grove Basin contract
     *      for the `collateralToken` wiring used by this integration). The hard guarantee is
     *      enforced by Grove Basin reverting the swap when the pool cannot satisfy the requested
     *      output.
     * @return Liquidity token balance available at the Grove Basin liquidity custodian.
     */
    function _availableLiquidity() private view returns (uint256) {
        return liquidityToken.balanceOf(getLiquidityCustodian());
    }

    /**
     * @inheritdoc BaseExternalProvider
     */
    function _expectedCollateralToken() internal view override returns (address) {
        return address(liquidityToken);
    }

    /**
     * @inheritdoc BaseExternalProvider
     */
    function _expectedCreditToken() internal view override returns (address) {
        return address(assetToken);
    }
}
