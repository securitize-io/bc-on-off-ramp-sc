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
 *         {supplyExactIn} by being deployed with `custodianWallet == address(this)`. The contract
 *         holds no liquidity-token treasury: the swap spends exactly the subscription's net liquidity
 *         via {IGroveBasin.swapExactIn}, so nothing of this subscription is left behind.
 *
 *         The swap uses {IGroveBasin.swapExactIn} (exact liquidity in) bound to the net liquidity the
 *         on-ramp forwards (not the whole on-hand balance), so a stray liquidity-token donation is
 *         neither swept into the swap nor able to revert the subscription; any surplus stays on the
 *         provider and is recoverable via {rescueTokens}. The companion {ExternalAssetProviderOnRamp}
 *         sizes each subscription's expected asset amount from {quoteAsset} (the same
 *         {IGroveBasin.previewSwapExactIn} quote used here, over the same net liquidity), so the
 *         amount the on-ramp forwards in two-step equals what Grove Basin delivers — by construction,
 *         with no dust and no shortfall. {supplyExactIn} re-derives the quote for the net liquidity
 *         and reverts with {UnexpectedSwapOutputError} on an inconsistent NAV/Grove Basin state. The
 *         balance-based {supplyTo} entrypoint is disabled ({DirectSupplyNotSupported}).
 *
 *         Because Grove Basin sets the price the investor pays, {supplyExactIn} additionally
 *         cross-checks that quote against the Securitize NAV with the inherited tolerance band
 *         ({_validateRateBand}/{rateTolerance}); a Grove Basin quote diverging beyond the band
 *         reverts. The NAV side of that check is pre-fee while the Grove Basin quote is net of Grove
 *         Basin's purchase fee, so admins MUST keep {rateTolerance} at or above the expected Grove
 *         Basin fee plus a margin (see {BaseExternalProvider.rateTolerance}); otherwise a Grove Basin
 *         fee near the band reverts legitimate subscriptions with {MinRateDivergenceError}. NAV math
 *         is computed internally from {navProvider} (which must match the on-ramp's
 *         NAV provider); the provider never calls back into the on-ramp. Because the reference is a
 *         local copy, it is admin-rotatable via {updateNavProvider} and MUST be rotated together with
 *         the on-ramp's {SecuritizeOnRamp.updateNavProvider}: a divergence would price the band cross-check
 *         off a stale NAV and revert every subscription until realigned (no UUPS upgrade required).
 *
 *         The shared Grove Basin handle, referral code and tolerance live in
 *         {BaseExternalProvider}. Token wiring mirrors the off-ramp: {liquidityToken} is
 *         Grove Basin's `collateralToken` and {asset} is its `creditToken`.
 */
contract ExternalAssetProvider is IExternalAssetProvider, BaseExternalProvider {
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
     *      Admin-rotatable via {updateNavProvider}; keep it aligned with the on-ramp's NAV provider.
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
        __BaseExternalProvider_init(_groveBasin);
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
     * @inheritdoc IExternalAssetProvider
     */
    function updateNavProvider(address _navProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_navProvider == address(0)) {
            revert NonZeroAddressError();
        }
        emit NavProviderUpdated(address(navProvider), _navProvider);
        navProvider = ISecuritizeNavProvider(_navProvider);
    }

    /**
     * @notice Disabled balance-based entrypoint; use {supplyExactIn}.
     * @dev The external Grove Basin provider binds each swap to the subscription's net liquidity via
     *      {supplyExactIn} so a token donation cannot change the swapped amount. The companion
     *      {ExternalAssetProviderOnRamp} always drives the provider through {supplyExactIn}; this
     *      balance-based entrypoint is intentionally disabled.
     */
    function supplyTo(address, uint256) public pure {
        revert DirectSupplyNotSupported();
    }

    /**
     * @notice Swaps exactly `_netLiquidity` of the liquidity token held by this contract for the
     *         asset through Grove Basin.
     * @dev Called by the on-ramp after the net liquidity has been settled on this contract
     *      (`custodianWallet == address(this)`). The swap is bound to `_netLiquidity` (the amount the
     *      on-ramp just transferred) rather than the whole on-hand balance, so a stray token donation
     *      neither changes the swapped amount nor reverts the subscription; any surplus stays on the
     *      provider and is recoverable via {rescueTokens}.
     *
     *      It previews swapping `_netLiquidity` through Grove Basin with {previewSwapExactIn}. The
     *      on-ramp sizes `_expectedAssetAmount` from the same quote over the same net liquidity (see
     *      {quoteAsset}), so the two must match; a mismatch signals an inconsistent NAV/Grove Basin
     *      state and reverts with {UnexpectedSwapOutputError}.
     *
     *      It then cross-checks the Grove Basin quote against the Securitize NAV with the tolerance
     *      band ({_validateRateBand}) so a diverged Grove Basin oracle cannot set an arbitrary price,
     *      and executes {swapExactIn} for `_netLiquidity` with `minAmountOut == _expectedAssetAmount`
     *      as Grove Basin's native floor.
     * @param _buyer Recipient of the asset (the investor in single-step, the on-ramp in two-step).
     * @param _netLiquidity Net liquidity (after the on-ramp fee) to swap for this subscription.
     * @param _expectedAssetAmount Asset amount (before fee) the on-ramp expects for this subscription.
     */
    function supplyExactIn(
        address _buyer,
        uint256 _netLiquidity,
        uint256 _expectedAssetAmount
    ) external whenNotPaused onlySecuritizeOnRamp {
        if (_netLiquidity == 0) {
            revert ZeroAmountToSwap();
        }

        IERC20Metadata _liquidityToken = liquidityToken;
        uint256 balance = _liquidityToken.balanceOf(address(this));
        if (balance < _netLiquidity) {
            revert InsufficientLiquidityToSwap(_netLiquidity, balance);
        }

        // Asset amount Grove Basin would deliver for exactly this subscription's net liquidity. The
        // on-ramp sizes the expected amount from this same quote over the same net, so a mismatch
        // signals an inconsistent NAV/Grove Basin state; reject it instead of delivering an amount
        // the buyer did not agree to. Binding to the net (not the balance) means a donation is ignored.
        IDSToken _asset = asset;
        uint256 gbAmountOut = externalProvider.previewSwapExactIn(
            address(_liquidityToken),
            address(_asset),
            _netLiquidity
        );
        if (gbAmountOut != _expectedAssetAmount) {
            revert UnexpectedSwapOutputError(_expectedAssetAmount, gbAmountOut);
        }

        // Reject dust-sized subscriptions whose Grove Basin quote floors to zero. `gbAmountOut` is
        // forwarded as Grove Basin's `minAmountOut` (via `_expectedAssetAmount`), so a zero quote would
        // silently remove the swap floor (`amountOut < 0` never holds). Rejecting here keeps the
        // documented price floor intact for every accepted subscription.
        if (gbAmountOut == 0) {
            revert ZeroAmountToSwap();
        }

        // Grove Basin sets the price the investor pays; cross-check it against the Securitize NAV so a
        // manipulated/diverged Grove Basin oracle cannot price the swap outside the tolerance band.
        _validateRateBand(_assetForLiquidity(_netLiquidity), gbAmountOut);

        uint256 available = availableAsset();
        if (gbAmountOut > available) {
            revert InsufficientAssetLiquidity(gbAmountOut, available);
        }

        _liquidityToken.forceApprove(address(externalProvider), _netLiquidity);

        externalProvider.swapExactIn(
            address(_liquidityToken),
            address(_asset),
            _netLiquidity,
            _expectedAssetAmount,
            _buyer,
            referralCode
        );
    }

    /**
     * @inheritdoc IExternalAssetProvider
     */
    function quoteAsset(uint256 _netLiquidity) external view returns (uint256) {
        return externalProvider.previewSwapExactIn(address(liquidityToken), address(asset), _netLiquidity);
    }

    /**
     * @notice Returns a best-effort upper bound on the asset amount available for purchases in Grove Basin.
     * @dev Reads the raw asset balance at the Grove Basin asset custodian. In this integration the
     *      asset is Grove Basin's `creditToken`, held by the Grove Basin contract itself.
     *
     *      This is an UPPER BOUND, not the exact deliverable capacity. It reads the raw ERC-20 balance
     *      and does NOT net out portions that Grove Basin may treat as non-deliverable (e.g. seed
     *      deposit, fee-claimer accrual, or collateral reserved against pending redemptions), and it
     *      does NOT model the {asset} DSToken compliance rules (whitelist, lock-ups, holder caps,
     *      jurisdiction) that may reject the swap output for a specific buyer. Off-chain integrators
     *      sizing batches from this view should treat it as an optimistic ceiling. The hard guarantee
     *      is enforced on-chain: Grove Basin reverts the swap when the pool cannot satisfy the output,
     *      and the DSToken reverts the delivery when compliance rejects it for the buyer.
     * @return A best-effort upper bound on the asset amount available at the Grove Basin asset custodian.
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
     * @inheritdoc BaseExternalProvider
     */
    function _expectedCollateralToken() internal view override returns (address) {
        return address(liquidityToken);
    }

    /**
     * @inheritdoc BaseExternalProvider
     */
    function _expectedCreditToken() internal view override returns (address) {
        return address(asset);
    }
}
