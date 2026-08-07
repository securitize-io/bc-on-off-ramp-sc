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

import {IExternalAssetProvider} from "../provider/IExternalAssetProvider.sol";

/**
 * @title  MockExternalAssetProviderOnRamp
 * @notice Minimal on-ramp double that drives {ExternalAssetProvider.supplyExactIn} with a freely
 *         settable transfer mode and swap receiver.
 * @dev    Exists to make {BaseExternalProvider.onlyTwoStepTransfer} reachable on the buy side. The
 *         production {ExternalAssetProviderOnRamp} cannot reproduce the single-step configuration:
 *         it enables two-step at initialization, rejects `toggleTwoStepTransfer(false)` outright and
 *         re-checks the flag in `_executeAssetTransfer` before ever calling the provider. The
 *         provider's own guard is therefore unreachable through it by construction — which is the
 *         point of a backstop, and the reason it needs a double to be tested.
 *
 *         Only the surface the guard reads is implemented ({twoStepTransfer}); this is not a
 *         functional on-ramp and must never be wired outside tests.
 */
contract MockExternalAssetProviderOnRamp {
    /// @dev Transfer mode reported to the provider's {BaseExternalProvider.onlyTwoStepTransfer} gate.
    bool public twoStepTransfer;

    constructor(bool _twoStepTransfer) {
        twoStepTransfer = _twoStepTransfer;
    }

    /**
     * @notice Sets the transfer mode this double reports.
     * @param _twoStepTransfer Mode to report; `false` is the single-step configuration the provider rejects.
     */
    function setTwoStepTransfer(bool _twoStepTransfer) external {
        twoStepTransfer = _twoStepTransfer;
    }

    /**
     * @notice Calls {ExternalAssetProvider.supplyExactIn} as the wired on-ramp.
     * @dev The receiver is a free parameter so a test can drive the provider with an arbitrary buyer,
     *      which the production on-ramp never does (it always passes its own address).
     * @param _provider Provider to drive.
     * @param _buyer Swap receiver to forward.
     * @param _netLiquidity Net liquidity to swap.
     * @param _expectedAssetAmount Asset amount expected for that net liquidity.
     */
    function supplyExactIn(
        address _provider,
        address _buyer,
        uint256 _netLiquidity,
        uint256 _expectedAssetAmount
    ) external {
        IExternalAssetProvider(_provider).supplyExactIn(_buyer, _netLiquidity, _expectedAssetAmount);
    }
}
