# On-Ramp ↔ External Asset Provider

How `ExternalAssetProvider` + `ExternalAssetProviderOnRamp` work, and what they require of whatever
external provider is wired as the counterparty.

This document is **counterparty-agnostic**: everything here is enforced by Securitize contracts in this
repository and holds regardless of what sits behind `externalProvider`. The preconditions that live on
the counterparty are in a per-counterparty runbook — for the production topology see
[`ethena-psm-adapter-runbook.md`](./ethena-psm-adapter-runbook.md).

An investor pays the liquidity token (e.g. USDC) into the on-ramp and receives the asset (a DSToken /
RWA such as BUIDL), sourced by swapping that liquidity through the external provider in the same
transaction.

---

## 1. How it works

`ExternalAssetProviderOnRamp` is a `SecuritizeOnRamp` that overrides one thing: it **quotes the asset
amount from the external provider** (`previewSwapExactIn` over the net liquidity) instead of from the
Securitize NAV. Per subscription:

1. The on-ramp pulls the gross liquidity from the investor, sends the **Securitize fee** to the fee
   collector, and settles the **net** liquidity on the provider (`custodianWallet == provider`).
2. `calculateDsTokenAmount` sizes `dsTokenAmount = provider.quoteAsset(net)` — the external provider's
   exact-in quote for that net.
3. The on-ramp calls `provider.supplyExactIn(onRamp, net, dsTokenAmount)`. The provider:
   - re-quotes `previewSwapExactIn(liquidityToken, asset, net)` and requires it to equal
     `dsTokenAmount` (→ `UnexpectedSwapOutputError`);
   - rejects a quote that floors to zero (→ `ZeroAmountToSwap`), which would otherwise remove the swap's
     own price floor;
   - **cross-checks** that quote against the Securitize NAV within the tolerance band (`rateTolerance`,
     default 1%) → `MinRateDivergenceError` / `MaxRateDivergenceError`;
   - gates on the provider's reported deliverable capacity (`availableAsset()`) →
     `InsufficientAssetLiquidity`;
   - executes `swapExactIn(liquidityToken, asset, net, minAmountOut = dsTokenAmount, onRamp,
     referralCode)`.
4. The on-ramp forwards the asset to the investor.

Because the on-ramp and the provider quote from the **same** preview in the same transaction, the amount
the on-ramp forwards equals what the provider delivers — **by construction**.

### The swap is bound to the net, not to the balance
`supplyExactIn` swaps exactly the net liquidity the on-ramp just settled, never the provider's on-hand
balance. A stray liquidity-token donation therefore neither changes the swapped amount nor reverts the
subscription; any surplus stays on the provider and is recoverable via `rescueTokens`.

> **Do not read this as "pre-funding is forbidden."** It is explicitly tolerated. An earlier revision of
> this guide told operators the opposite.

### `supplyTo` is disabled
The balance-based entrypoint reverts unconditionally with `DirectSupplyNotSupported`. Every asset
delivery goes through `supplyExactIn`.

---

## 2. Delivery is two-step only

The asset goes `external provider → on-ramp → investor`. Single-step delivery (provider → investor
directly) is **not supported** and is rejected at three points:

| Point | Behaviour |
|---|---|
| `initialize` | Enables `twoStepTransfer`, rather than inheriting the `false` default (which *is* single-step) |
| `toggleTwoStepTransfer(false)` | Reverts `SingleStepNotSupported`, for any caller, before the role check |
| `_executeAssetTransfer` | Reverts `SingleStepNotSupported` if the flag is somehow `false` (e.g. a proxy upgraded from before the guard) |

Two reasons, either sufficient:

- **The counterparty binds the receiver.** A PSM adapter accepts exactly one receiver address per
  direction; an arbitrary investor address is rejected. See the runbook.
- **RWA compliance.** Two-step delivers the DSToken from the whitelisted on-ramp address, which is what
  transfer-restricted assets require.

The deploy task rejects `--single-step` before deploying anything.

---

## 3. Securitize fees are charged before the swap

Fee handling happens **before** any external provider call, in `BaseOnRamp._executeLiquidityTransfer`:

1. Pull gross liquidity from the investor.
2. Send the Securitize fee (`feeManager.getFee(gross)`) to the fee collector.
3. Settle only the **net** (`gross − fee`) on the provider.
4. The provider swaps the **net**.

`quoteAsset` is computed on the same net, so the asset amount matches the liquidity actually swapped.
Any Securitize fee can be run independently of the counterparty's own fee.

---

## 4. Token wiring

| Securitize term | External provider term | Example |
|---|---|---|
| `liquidityToken` | `collateralToken` | USDC |
| `asset` (DSToken) | `creditToken` | BUIDL |
| — | `swapToken` | unused by this integration; must be distinct from both |

Validated on-chain at `initialize` and at `setExternalProvider`:

- `collateralToken() == liquidityToken` else `CollateralTokenMismatch`
- `creditToken() == asset` else `CreditTokenMismatch`
- `swapToken()` distinct from both else `SwapTokenOverlap`
- `pocket() != address(0)` else `PocketZeroAddressError`
- the candidate answers `availableAsset()` else `ExternalProviderMissingAvailableAsset`

### The counterparty must expose `availableAsset()`
`ExternalAssetProvider.availableAsset()` delegates to `IPSMAdapter.availableAsset()` on the wired
provider, because the provider is the authority on its own deliverable capacity. An adapter fronting a
PSM holds no asset inventory of its own, so reading the raw asset balance at the provider address
reports zero and rejects every subscription.

The call is **not guarded**, so `_validateProviderCapabilities` probes the candidate with a `staticcall`
before storing it and reverts with `ExternalProviderMissingAvailableAsset`. Two consequences:

- **A plain Grove Basin (PSM3) pool cannot be wired to this on-ramp.** It does not implement
  `availableAsset()`. It must be fronted by an adapter that does. (The off-ramp
  `ExternalLiquidityProvider` computes capacity from balances and *does* stay wirable to a plain pool —
  the probe is an opt-in hook on the shared base, not a global requirement.)
- **The probe is point-in-time.** It checks the candidate's code at wiring time. It cannot bind a
  provider that stops answering later, e.g. an upgradeable adapter whose implementation is swapped. It
  narrows the failure window rather than closing it.

### `availableAsset()` is an upper bound
It does not model the DSToken compliance rules (whitelist, lock-ups, holder caps, jurisdiction) that may
reject the delivery for a specific buyer, and another subscription can consume it in the same block.
Off-chain integrators should treat it as an optimistic ceiling. The hard guarantees stay on-chain: the
provider reverts the swap when it cannot deliver, and the DSToken reverts when compliance rejects the
buyer.

---

## 5. The NAV tolerance band

The counterparty sets the price the investor pays, so `supplyExactIn` cross-checks that quote against the
Securitize NAV within a symmetric band around the NAV amount (`BaseExternalProvider._validateRateBand`).

`rateTolerance` is in units of `TOLERANCE_DENOMINATOR = 100_000` (1_000 = 1%), default 1%:

- `100_000` (100%) — full trust, the check is skipped entirely. **This removes the only sanity check on
  the price the investor pays.**
- `0` — zero trust, the quote must equal the NAV exactly.
- otherwise — the quote must fall inside the band.

**Asymmetry.** The NAV side is *pre-fee* while the provider's quote is *net* of the counterparty's fee,
so that fee only ever pushes the quote toward the lower edge. `rateTolerance` must cover the
counterparty's fee plus a margin, or legitimate subscriptions revert with `MinRateDivergenceError` on
fee-only divergence.

**The band's budget is shared.** Whatever the counterparty's pricing does *not* consume is available to
absorb NAV movement, and vice versa. What that means in practice depends entirely on the counterparty's
price behaviour — see the runbook, which for a 1:1-pegged adapter turns this into a hard constraint on
how far the NAV may sit from parity.

> **NAV providers must match.** The provider's band uses its own `navProvider`, which must equal the
> on-ramp's. Rotate them together (`updateNavProvider` on both); a divergence prices the band off a stale
> NAV and reverts every subscription. No UUPS upgrade is required to realign.

---

## 6. Deploy and wire

The bundled task deploys the provider first (so the on-ramp can be initialized with
`custodianWallet == provider`), deploys `ExternalAssetProviderOnRamp`, wires both, and enables investor
subscription.

```bash
npx hardhat deploy-on-ramp-external-asset-provider \
  --asset <DSToken address> \
  --liquidity-token <USDC address> \
  --nav-provider <Securitize NAV provider address> \
  --fee-manager <on-ramp fee manager address> \
  --grove-basin <external provider / adapter address> \
  --network <network>
  # --rate-tolerance <n>        override the 1% contract default
  # --referral-code <n>         forwarded to the provider on each swap
  # --min-available-asset <n>   require at least this reported capacity to finish (default: non-zero)
```

The task refuses to finish while the wired provider reports **zero** deliverable capacity, because that
is the single observable symptom of every way the counterparty-side funding can be wrong. See the runbook
for what to check when it fires.

Two-step needs no toggle: `initialize` sets it.

### After the task
- Set `minSubscriptionAmount` — the default of `0` lets dust subscriptions through, and a counterparty
  may impose its own minimum on the **net**. See the runbook.
- Verify the counterparty-side wiring the task cannot set (approved caller and approved receiver).

---

## 7. Troubleshooting — errors raised by *these* contracts

Reverts from the counterparty are in the runbook; a revert not listed in either place is coming from the
DSToken's compliance rules or from the counterparty's own dependencies.

| Revert | Cause | Fix |
|---|---|---|
| `ExternalProviderMissingAvailableAsset` | Candidate does not answer `availableAsset()` with a decodable `uint256` — e.g. a plain Grove Basin pool. | Wire an adapter that implements it. |
| `CollateralTokenMismatch` / `CreditTokenMismatch` / `SwapTokenOverlap` / `PocketZeroAddressError` | Token wiring does not match. | Point at a correctly wired provider. |
| `SingleStepNotSupported` | Single-step delivery configured or reached. | Keep two-step. Delivery to the investor is the on-ramp's job, not the provider's. |
| `BridgeModeNotSupported` | Bridge mode attempted. | Incompatible by design: the net must settle same-chain on the provider. |
| `MinRateDivergenceError` | Quote below the band — usually the counterparty's fee, or a NAV above the counterparty's price. | Raise `rateTolerance` to cover the fee plus margin, or realign the NAV. |
| `MaxRateDivergenceError` | Quote above the band — the counterparty prices the asset higher than the NAV does. | Realign the NAV, or raise `rateTolerance` deliberately. |
| `UnexpectedSwapOutputError(expected, quoted)` | The re-quote disagrees with the amount the on-ramp sized. Signals an inconsistent NAV / provider state mid-transaction, or a provider/NAV mismatch between the two contracts. | Ensure provider and on-ramp share the same NAV provider and external provider. **Not** caused by pre-funding. |
| `InsufficientAssetLiquidity(requested, available)` | The provider reports less deliverable capacity than the quote. `available` is the provider's own netted figure, **not** a balance at any address. | Counterparty-side. See the runbook. |
| `ZeroAmountToSwap` | Either the net liquidity is zero, or the quote for it floors to zero (dust). | Raise `minSubscriptionAmount`. |
| `InsufficientLiquidityToSwap(net, balance)` | The net has not landed on the provider. | Ensure `custodianWallet == provider`. |
| `NonZeroNavRateError` | NAV rate is zero, so the band cannot be computed. | Fix the NAV provider. |
| `DirectSupplyNotSupported` | `supplyTo` was called. | Use `supplyExactIn`; the on-ramp already does. |
| `UnauthorizedAccount` | `supplyExactIn` called by anything other than the wired on-ramp. | Wire with `setSecuritizeOnRamp`. |

---

## 8. Summary

`ExternalAssetProviderOnRamp` quotes the asset from the external provider so the on-ramp forwards exactly
what the swap delivers — no dust, no benign-divergence reverts — while the Securitize NAV remains an
independent ±`rateTolerance` sanity band. Securitize fees are charged on the gross before the provider is
called, and only the net is swapped. Delivery is two-step only. The provider is the authority on its own
deliverable capacity, and must be able to say so via `availableAsset()`.
