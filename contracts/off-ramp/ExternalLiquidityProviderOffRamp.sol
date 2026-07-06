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

import {SecuritizeOffRamp} from "./SecuritizeOffRamp.sol";
import {IExternalLiquidityProvider} from "./provider/IExternalLiquidityProvider.sol";
import {TokenCalculator} from "./TokenCalculator.sol";
import {RedemptionManager} from "./RedemptionManager.sol";

/**
 * @title ExternalLiquidityProviderOffRamp
 * @notice Securitize off-ramp specialized for redemptions sourced through Grove Basin via an
 *         {ExternalLiquidityProvider}.
 * @dev    Identical to {SecuritizeOffRamp} except for the public quote {calculateLiquidityTokenAmount},
 *         which is overridden to price the redemption from the Grove Basin exact-in quote
 *         ({IGroveBasin.previewSwapExactIn}) instead of the Securitize NAV. Because Grove Basin is an
 *         external venue with its own oracle and fee policy, this makes the displayed quote (and any
 *         off-chain `minOutputAmount` derived from it) reflect what Grove Basin will actually pay —
 *         both its rate and its redemption fee — so it matches the amount delivered on redemption.
 *
 *         {calculateLiquidityTokenAmountBeforeFee} is intentionally NOT overridden: it remains the
 *         Securitize NAV quote, which {ExternalLiquidityProvider.supplyTo} uses both as the
 *         subscription binding and as the independent anchor of the NAV-vs-Grove-Basin tolerance
 *         band. Overriding it would collapse that band (Grove vs Grove) and break the redemption
 *         binding, so it is left to the base implementation.
 *
 *         The realized redemption amount and the tolerance band are unchanged from the base flow.
 */
contract ExternalLiquidityProviderOffRamp is SecuritizeOffRamp {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Proxy initializer; identical to {SecuritizeOffRamp.initialize}.
     * @dev Forwards to the parent initializer (which carries the `initializer`/`onlyProxy` guards),
     *      so it is declared on this leaf contract for the upgrades tooling without re-applying the
     *      one-shot `initializer` modifier (which would revert on the nested parent call).
     * @param _asset DS asset address.
     * @param _navProvider NAV provider address.
     * @param _feeManager Fee manager address.
     * @param _assetBurn Whether redeemed asset is burned (must be false for this pairing).
     */
    function initialize(
        address _asset,
        address _navProvider,
        address _feeManager,
        bool _assetBurn
    ) public override {
        super.initialize(_asset, _navProvider, _feeManager, _assetBurn);
    }

    /**
     * @inheritdoc SecuritizeOffRamp
     * @dev Quotes the liquidity from the Grove Basin exact-in preview over `_assetAmount` (which
     *      already includes Grove Basin's rate and redemption fee), then deducts the Securitize fee.
     *      Independent of the Securitize NAV: it is a best-effort estimate of what Grove Basin would
     *      pay, not a redeemability guarantee. Redemption preconditions (non-zero NAV, the tolerance
     *      band, liquidity, pause) are enforced at {redeem}, not here.
     */
    function calculateLiquidityTokenAmount(
        uint256 _assetAmount
    ) public view override nonZeroLiquidityProvider returns (uint256) {
        IExternalLiquidityProvider provider = IExternalLiquidityProvider(address(liquidityProvider));
        uint256 grossLiquidity = provider.externalProvider().previewSwapExactIn(
            address(provider.assetToken()),
            address(provider.liquidityToken()),
            _assetAmount
        );

        uint256 fee = TokenCalculator.calculateFee(feeManager, grossLiquidity);
        return grossLiquidity - fee;
    }

    /**
     * @notice Executes the two-step redemption bound to the redemption's own asset amount.
     * @dev Drives the {ExternalLiquidityProvider} through {IExternalLiquidityProvider.supplyExactIn},
     *      binding the Grove Basin swap to the redemption's own asset amount instead of the provider's
     *      on-hand balance. This makes a stray asset donation to the provider irrelevant to the swap:
     *      it is neither swept into the redemption nor able to revert it.
     */
    function _executeTwoStepRedemption(
        RedemptionManager.RedemptionParams memory _params
    ) internal override returns (uint256 fee, uint256 liquidityValue) {
        return RedemptionManager.executeTwoStepRedemptionExactIn(_params, address(this));
    }
}
