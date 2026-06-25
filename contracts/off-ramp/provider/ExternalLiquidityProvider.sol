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
 *         asset here right before calling {supplyTo}. The contract never holds asset nor
 *         liquidity token beyond the duration of a single redemption call.
 *
 *         {supplyTo} reverts with {TwoStepTransferRequired} unless the linked off-ramp has
 *         two-step transfer enabled. Single-step redemptions are unsupported because this
 *         provider swaps the full on-hand asset balance on each call.
 *
 *         {supplyTo} also reverts with {AssetBurnNotSupported} when the linked off-ramp has
 *         asset burning enabled, because the asset must be transferred here before the swap.
 *
 *         Before executing the Grove Basin swap, the provider compares the Securitize NAV quote
 *         with the Grove Basin preview quote and reverts when they diverge beyond {redeemTolerance}.
 */
contract ExternalLiquidityProvider is IExternalLiquidityProvider, BaseContract {
    using SafeERC20 for IERC20Metadata;

    /// @dev Denominator for {redeemTolerance}; 100_000 equals 100%.
    uint256 public constant TOLERANCE_DENOMINATOR = 100_000;

    /// @dev Default {redeemTolerance} set on initialization (1_000 = 1%).
    uint256 public constant DEFAULT_REDEEM_TOLERANCE = 1_000;

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
    IGroveBasin public externalProvider;

    /**
     * @dev Wallet that receives the asset; resolves to this contract so it can be swapped.
     */
    address public recipient;

    /**
     * @dev Referral code forwarded to Grove Basin on each swap.
     */
    uint256 public referralCode;

    /**
     * @dev Maximum allowed divergence between Securitize NAV and Grove Basin preview quotes.
     *      Expressed in units of {TOLERANCE_DENOMINATOR} (1_000 = 1%).
     */
    uint256 public redeemTolerance;

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
        address _groveBasin
    ) public onlyProxy initializer {
        if (_liquidityToken == address(0) || _securitizeOffRamp == address(0) || _groveBasin == address(0)) {
            revert NonZeroAddressError();
        }
        __BaseContract_init();
        liquidityToken = IERC20Metadata(_liquidityToken);
        securitizeOffRamp = IBaseOffRamp(_securitizeOffRamp);
        assetToken = IERC20Metadata(IBaseOffRamp(_securitizeOffRamp).assetAddress());
        _validateGroveBasinConfig(IGroveBasin(_groveBasin), liquidityToken, assetToken);
        externalProvider = IGroveBasin(_groveBasin);
        recipient = address(this);
        redeemTolerance = DEFAULT_REDEEM_TOLERANCE;
    }

    /**
     * @notice Sets a new Grove Basin contract address.
     * @param _groveBasin New Grove Basin (PSM3) address.
     */
    function setExternalProvider(address _groveBasin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_groveBasin == address(0)) {
            revert NonZeroAddressError();
        }
        _validateGroveBasinConfig(IGroveBasin(_groveBasin), liquidityToken, assetToken);
        emit ExternalLiquidityProviderUpdated(address(externalProvider), _groveBasin);
        externalProvider = IGroveBasin(_groveBasin);
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
     * @notice Sets the maximum allowed divergence between Securitize NAV and Grove Basin preview quotes.
     * @param _redeemTolerance New tolerance in units of {TOLERANCE_DENOMINATOR} (1_000 = 1%).
     */
    function setRedeemTolerance(uint256 _redeemTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_redeemTolerance > TOLERANCE_DENOMINATOR) {
            revert InvalidRedeemToleranceError(_redeemTolerance);
        }
        emit RedeemToleranceUpdated(redeemTolerance, _redeemTolerance);
        redeemTolerance = _redeemTolerance;
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
        custodian = address(liquidityToken) == externalProvider.swapToken()
            ? externalProvider.pocket()
            : address(externalProvider);
        if (custodian == address(0)) {
            revert PocketZeroAddressError();
        }
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
     * @notice Swaps the asset held by this contract for liquidity token through Grove Basin.
     * @dev Called by the off-ramp two-step flow after the asset has been transferred here.
     *      Reverts with {AssetBurnNotSupported} when the linked off-ramp burns redeemed assets,
     *      because this provider must receive the asset before swapping it through Grove Basin.
     *
     *      The swap is bound to the current redemption: the off-ramp forwards, as the second
     *      argument, the NAV gross it expects for the redeemed asset amount. This function derives
     *      the NAV gross from its on-hand asset balance and reverts with {UnexpectedAssetBalanceError}
     *      when the two differ, so any pre-existing or stuck asset sitting on this contract is not
     *      swept into the caller's redemption (the provider must hold only the current redemption's
     *      asset, per its single-redemption custody model).
     *
     *      Afterwards it compares the Securitize NAV quote with the Grove Basin preview before
     *      spending swap gas. The swap floor is set to the Grove Basin preview so Basin's native
     *      slippage protection is enforced as a second line of defense.
     * @param _receiver Recipient of the liquidity token (the off-ramp contract).
     * @param _expectedLiquidityAmount NAV gross (before fee) the off-ramp expects for this redemption.
     * @return amountOut Liquidity token amount delivered by Grove Basin.
     */
    function supplyTo(
        address _receiver,
        uint256 _expectedLiquidityAmount
    ) public whenNotPaused onlySecuritizeRedemption onlyTwoStepTransfer onlyWithoutAssetBurn returns (uint256 amountOut) {
        IERC20Metadata _assetToken = assetToken;
        uint256 amountIn = _assetToken.balanceOf(address(this));
        if (amountIn == 0) {
            revert ZeroAmountToSwap();
        }

        IGroveBasin _groveBasin = externalProvider;

        uint256 navGross = ISecuritizeOffRamp(address(securitizeOffRamp)).calculateLiquidityTokenAmountBeforeFee(
            amountIn
        );

        // Bind the swap to the asset delivered by THIS redemption. A mismatch means the on-hand
        // balance includes asset that does not belong to the current redemption; reject instead of
        // sweeping it (which would pay the redeemer for asset they did not redeem).
        if (navGross != _expectedLiquidityAmount) {
            revert UnexpectedAssetBalanceError(_expectedLiquidityAmount, navGross);
        }

        uint256 gbPreview = _groveBasin.previewSwapExactIn(
            address(_assetToken),
            address(liquidityToken),
            amountIn
        );

        _validateRateBand(navGross, gbPreview);

        uint256 available = _availableLiquidity();
        if (gbPreview > available) {
            revert InsufficientLiquidity(gbPreview, available);
        }

        _assetToken.forceApprove(address(_groveBasin), amountIn);

        amountOut = _groveBasin.swapExactIn(
            address(_assetToken),
            address(liquidityToken),
            amountIn,
            gbPreview,
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

    /**
     * @dev Reverts when a Grove Basin candidate does not match this integration's token wiring.
     *      The liquidity token must match Grove Basin's `collateralToken` and the asset must match
     *      `creditToken`. `swapToken` is not used for this integration's redemption path.
     * @param candidate Grove Basin contract to validate.
     * @param expectedLiquidity Liquidity token configured on this provider.
     * @param expectedAsset Asset token configured on this provider.
     */
    function _validateGroveBasinConfig(
        IGroveBasin candidate,
        IERC20Metadata expectedLiquidity,
        IERC20Metadata expectedAsset
    ) internal view {
        address candidateAddr = address(candidate);
        if (candidateAddr.code.length == 0) {
            revert NotAContract(candidateAddr);
        }
        if (candidate.collateralToken() != address(expectedLiquidity)) {
            revert CollateralTokenMismatch(address(expectedLiquidity), candidate.collateralToken());
        }
        if (candidate.creditToken() != address(expectedAsset)) {
            revert CreditTokenMismatch(address(expectedAsset), candidate.creditToken());
        }
        if (candidate.pocket() == address(0)) {
            revert PocketZeroAddressError();
        }
    }

    /**
     * @dev Reverts when the Grove Basin preview falls outside the NAV tolerance band.
     * @param navGross Securitize NAV quote before fees.
     * @param gbPreview Grove Basin preview quote for the same input amount.
     */
    function _validateRateBand(uint256 navGross, uint256 gbPreview) internal view {
        uint256 tolerance = redeemTolerance;
        uint256 minBand = navGross * (TOLERANCE_DENOMINATOR - tolerance) / TOLERANCE_DENOMINATOR;
        uint256 maxBand = navGross * (TOLERANCE_DENOMINATOR + tolerance) / TOLERANCE_DENOMINATOR;

        if (gbPreview < minBand) {
            revert MinRateDivergenceError(navGross, gbPreview, tolerance);
        }
        if (gbPreview > maxBand) {
            revert MaxRateDivergenceError(navGross, gbPreview, tolerance);
        }
    }
}
