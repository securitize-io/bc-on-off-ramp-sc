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

/**
 * @title  ITwoStepRamp
 * @notice Read-only view of a ramp's transfer mode, for collaborators that only need to know whether
 *         it settles in two steps.
 * @dev    Deliberately NOT added to {IOnOffRamp}: every ramp already exposes `twoStepTransfer` as a
 *         public state variable inherited from {BaseOnOffRamp}, so widening the shared interface
 *         would force an `override` on that variable and change the published ABI of ramps that have
 *         nothing to do with the external providers. Declaring the single getter separately reads the
 *         same slot through the same automatic accessor while leaving {IOnOffRamp}, {BaseOnOffRamp}
 *         and every concrete ramp untouched.
 *
 *         This is a view onto an existing contract, not a contract to be implemented: no ramp
 *         inherits it, and nothing should. {BaseExternalProvider.onlyTwoStepTransfer} casts to it so
 *         the shared provider base does not have to depend on a concrete ramp implementation.
 *
 *         The cast is unchecked, as any Solidity cast is: it assumes the address is a ramp. The
 *         providers only ever apply it to their own stored ramp, resolved through
 *         {BaseExternalProvider._ramp}, which is admin-wired and already the authorized caller. An
 *         address that does not answer the getter makes the call revert — the same failure an
 *         unwired ramp produces anyway.
 */
interface ITwoStepRamp {
    /**
     * @notice Reports whether the ramp settles through the two-step transfer flow.
     * @return True when the two-step transfer flow is enabled.
     */
    function twoStepTransfer() external view returns (bool);
}
