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

import {SecuritizeOnRamp} from "./SecuritizeOnRamp.sol";
import {IExternalAssetProvider} from "./provider/IExternalAssetProvider.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title ExternalAssetProviderOnRamp
 * @notice Securitize on-ramp specialized to source the asset through Grove Basin via an
 *         {ExternalAssetProvider}.
 * @dev    Identical to {SecuritizeOnRamp} except for how the asset amount is quoted. The base
 *         on-ramp derives `dsTokenAmount` from the Securitize NAV; this on-ramp derives it from the
 *         Grove Basin exact-in quote ({IExternalAssetProvider.quoteAsset}) over the net liquidity.
 *
 *         Because the provider's {ExternalAssetProvider.supplyTo} executes the same exact-in swap,
 *         the asset amount this on-ramp forwards in the two-step flow
 *         ({BaseOnRamp._executeAssetTransfer}) equals what Grove Basin delivers — so two-step leaves
 *         no dust and never reverts on a benign NAV/Grove Basin divergence, while single-step
 *         delivers the same amount straight to the investor. The provider still cross-checks the
 *         Grove Basin quote against the Securitize NAV tolerance band.
 *
 *         The Securitize fee is unchanged: it is charged on the gross liquidity (sent to the fee
 *         collector in {BaseOnRamp._executeLiquidityTransfer}) before any Grove Basin interaction,
 *         and only the net is swapped — which is exactly the amount quoted here.
 */
contract ExternalAssetProviderOnRamp is SecuritizeOnRamp {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Proxy initializer; identical to {SecuritizeOnRamp.initialize}.
     * @dev Forwards to the parent initializer (which carries the `initializer`/`onlyProxy` guards),
     *      so it is declared on this leaf contract for the upgrades tooling without re-applying the
     *      one-shot `initializer` modifier (which would revert on the nested parent call).
     * @param _dsToken DSToken (asset) address.
     * @param _liquidity Liquidity token (stablecoin) address.
     * @param _navProvider Securitize NAV provider address.
     * @param _feeManager Fee manager address.
     * @param _custodianWallet Custodian wallet (the {ExternalAssetProvider}).
     */
    function initialize(
        address _dsToken,
        address _liquidity,
        address _navProvider,
        address _feeManager,
        address _custodianWallet
    ) public override {
        super.initialize(_dsToken, _liquidity, _navProvider, _feeManager, _custodianWallet);
    }

    /**
     * @inheritdoc SecuritizeOnRamp
     * @dev Sizes the asset amount from the Grove Basin exact-in quote over the net liquidity (after
     *      the Securitize fee), instead of the NAV conversion used by the base on-ramp, so the
     *      forwarded amount matches the swap output in {ExternalAssetProvider.supplyTo}. `rate` is
     *      still reported from the NAV provider for the `Swap` event and off-chain reference.
     */
    function calculateDsTokenAmount(
        uint256 _liquidityAmount
    ) public view override returns (uint256 dsTokenAmount, uint256 rate, uint256 fee) {
        fee = feeManager.getFee(_liquidityAmount);
        uint256 netLiquidity = _liquidityAmount - fee;

        rate = navProvider.rate();
        dsTokenAmount = IExternalAssetProvider(address(assetProvider)).quoteAsset(netLiquidity);
    }

    /**
     * @notice Sources the asset by binding the Grove Basin swap to the subscription's net liquidity.
     * @dev Drives the {ExternalAssetProvider} through {IExternalAssetProvider.supplyExactIn}, binding
     *      the Grove Basin swap to `netLiquidity` (the net just settled on the provider) instead of
     *      the provider's on-hand balance. This makes a stray liquidity-token donation to the provider
     *      irrelevant to the swap: it is neither swept nor able to revert the subscription.
     */
    function _executeAssetTransfer(address to, uint256 amount, uint256 netLiquidity) internal override {
        IExternalAssetProvider provider = IExternalAssetProvider(address(assetProvider));
        if (twoStepTransfer) {
            provider.supplyExactIn(address(this), netLiquidity, amount);
            IERC20Metadata(address(dsToken)).transfer(to, amount);
        } else {
            provider.supplyExactIn(to, netLiquidity, amount);
        }
    }
}
