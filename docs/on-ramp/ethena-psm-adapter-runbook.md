# Runbook — `EthenaPSMAdapter` as the on-ramp counterparty

Operating the on-ramp against `EthenaPSMAdapter`, the production counterparty. Read
[`external-asset-provider.md`](./external-asset-provider.md) first: it covers what the Securitize
contracts enforce. This document covers the preconditions that live **outside** this repository, and the
constraints the adapter's behaviour imposes on our configuration.

> **Ownership boundary.** The adapter is deployed as "Securitize Credit" and delegates execution to
> Ethena's PSM. Most of what can break a subscription is configured on the adapter or the PSM, by roles
> our deploy keys do not hold. Everything below is stated as a **checkable invariant** for that reason:
> we cannot set it, so we verify it.
>
> Adapter behaviour here is transcribed from the `EthenaPSMAdapter` source. PSM-side setters are
> described by effect, not by signature — the PSM interface is Ethena's.

## Wired counterparty

Fill this in per deployment. Half the failure modes live on the other side of these addresses.

| | Address |
|---|---|
| `EthenaPSMAdapter` | |
| PSM (`adapter.psm()`) | |
| Asset send custodian (`psm.assetSendCustodianAddress()`) | |
| `ExternalAssetProvider` (ours) | |
| `ExternalAssetProviderOnRamp` (ours) | |

---

## 1. Custody model — why capacity is not a balance

The adapter holds **no BUIDL inventory**. On the buy direction:

```
EAP approves adapter for netUSDC
  → adapter pulls netUSDC
  → PSM.swap: USDC → collateral receive custodian, BUIDL → adapter
  → adapter forwards BUIDL to the OnRamp
```

BUIDL is delivered by the **PSM**, pulled from the PSM's asset send custodian. Reading BUIDL at the
adapter's address therefore reports zero even while swaps are fully serviceable. That is the condition
BC-2323 fixed: `ExternalAssetProvider.availableAsset()` now delegates to
`IPSMAdapter.availableAsset()` instead of reading a balance.

USDC ramp fees do accrue on the adapter between `sweep()` calls, so its USDC balance is non-zero and
means nothing about capacity either.

---

## 2. The funding invariant — the spender is the PSM

`availableAsset()` computes the custodian's contribution as:

```solidity
_min(
    IERC20(creditToken).balanceOf(sendCustodian),
    IERC20(creditToken).allowance(sendCustodian, address(psm))   // spender = the PSM
)
```

and the transfer that consumes it is executed by the **PSM** as `msg.sender` (the adapter calls
`psm.swap` with `benefactor == beneficiary == adapter`; it never moves BUIDL itself).

> **An allowance granted to the adapter is never read and never spent.**

Checkable invariant:

```
BUIDL.balanceOf(assetSendCustodian)              >= expected subscription volume
BUIDL.allowance(assetSendCustodian, psm)         >= expected subscription volume
```

This is the failure mode with the worst diagnostics: approving the wrong spender leaves the custodian's
**balance** looking correct, `availableAsset()` returns `0`, and every subscription is rejected. The zero
is indistinguishable from a genuinely unfunded custodian, so the natural next step — check the balance,
find it correct — points away from the cause. Check the allowance and its spender, not the balance.

The deploy task's capacity read-back exists to catch this at deploy time rather than at first
subscription.

---

## 3. Approved caller and approved receiver — required, and not set by us

The buy direction binds **both** ends:

```solidity
if (isSwapForAsset) {
    if (msg.sender != onProvider) revert CallerNotApproved();
    if (receiver != onRamp)       revert ReceiverNotApproved();
}
```

Both fields start at `address(0)` and are set on the adapter under `RAMP_MANAGER_ROLE` — **not a role our
deploy keys hold**. Our deploy task cannot set them.

Consequence: a freshly deployed on-ramp reverts **every** subscription with `CallerNotApproved` until
someone with `RAMP_MANAGER_ROLE` wires the adapter to it. This is the default state of every new
deployment, not a corner case.

Checkable invariant, after our deploy and after any provider or on-ramp redeploy:

```
adapter.onProvider() == <ExternalAssetProvider address>
adapter.onRamp()     == <ExternalAssetProviderOnRamp address>
```

`receiver != onRamp` is a single stored address, not an allowlist — which is also why single-step
delivery is structurally impossible here (the receiver would be an arbitrary investor). The adapter states
the intent directly: *"Enforces 'never send funds to a user directly' at the contract level."*

---

## 4. Minimum subscription size

`PSM_MIN_AMOUNT_IN = 10_000` (raw units of the input token; `0.01` USDC at 6 decimals). Both
`previewSwapExactIn` and `swapExactIn` revert `AmountInBelowPsmMinimum` below it.

The floor applies to the **net** liquidity, while the on-ramp's `minSubscriptionAmount` gates the
**gross** and defaults to `0`. Two consequences:

- A dust subscription reverts. Worse, it reverts inside `calculateDsTokenAmount`, a *view* — so the
  quote breaks before the swap is even attempted, and callers see an adapter error from a read call.
- `minSubscriptionAmount` must be set so that `gross − feeManager.getFee(gross) >= 10_000`, with margin
  for fee changes.

Checkable invariant:

```
onRamp.minSubscriptionAmount() − fee(onRamp.minSubscriptionAmount()) >= 10_000
```

---

## 5. Pricing — the adapter is pegged 1:1, which repurposes the NAV band

The adapter's intended configuration is `f = 0` (benefactor fee), `pegPrice = 1e18`, and a
`UnitOracleFeed` returning exactly `1e18` with `minOraclePrice == maxOraclePrice == 1e18`. Under that
configuration the quote is exactly the decimal-adjusted 1:1 amount.

Our band (`_validateRateBand`) compares that quote against the Securitize NAV amount. With a 1:1 quote,
the comparison reduces to:

> **the NAV price of BUIDL must stay within ±`rateTolerance` of 1.00 USDC**

`gbPreview / navQuote` equals the NAV price of BUIDL in USDC exactly, so a NAV of 1.02 with the default
1% tolerance reverts **every** subscription with `MaxRateDivergenceError`; a NAV of 0.98 reverts with
`MinRateDivergenceError`.

This holds in practice because BUIDL's NAV is designed to stay at $1.00 (yield is distributed as new
tokens rather than by appreciation). It is stated here because the failure mode is total and the coupling
is invisible from our side of the boundary.

Because `f = 0`, the counterparty fee consumes none of the band — the whole tolerance budget is available
to absorb NAV movement. If a non-zero benefactor fee is ever configured on the PSM, it comes out of that
same budget and `rateTolerance` must be raised to cover both.

### USDC depeg is not detected

The adapter's own documentation is explicit:

> *"The band is trivially satisfied on every call — UnitOracleFeed is a fixed feed and real-world USDC
> depeg is not detected; swaps execute at 1:1 regardless of actual USDC market price."*

Neither side of our band models the market price of USDC: the quote is a fixed peg, and the NAV is
BUIDL's, not USDC's. A depeg is therefore absorbed by whichever side is giving up the more valuable
token — on the buy direction, an investor paying depegged USDC still receives BUIDL at par.

There is no automatic protection. The controls are operational and manual:

- Ethena disabling swaps on the PSM (`isSwapEnabled() == false`), which makes `availableAsset()` return
  `0`;
- our `pause()` on `ExternalAssetProvider`, which blocks `supplyExactIn`.

Treat this as an accepted, monitored exposure, not as something the contracts handle.

---

## 6. PSM-side preconditions

All owned by Ethena. Each one, if unmet, makes `availableAsset()` return `0` or makes the quote revert.

| Precondition | Symptom if unmet |
|---|---|
| `isSwapEnabled() == true` | `availableAsset()` → `0`; quote reverts `PsmSwapDisabled` |
| Collateral registered and active for USDC (`isActive`, `decimals != 0`, `oracleFeed != 0`) | `availableAsset()` → `0`; quote reverts `PsmCollateralInactive` |
| Adapter registered as an **active benefactor** | `availableAsset()` → `0`; quote reverts `BenefactorNotActive` |
| Rate-limit headroom on the buy direction | `availableAsset()` → `0`, quote succeeds, subscription rejected with `InsufficientAssetLiquidity` |

### Rate limits — a cap of zero means zero headroom

`availableAsset()` takes the minimum over six headrooms: global, per-collateral and per-benefactor, each
for epoch and period. The headroom helper treats an unset cap as **no capacity**, not as unlimited:

```solidity
function _headroom(uint128 cap, uint128 used) internal pure returns (uint256) {
    if (cap == 0) return 0;
    return used < cap ? cap - used : 0;
}
```

Per-benefactor caps of `0` fall back to the global defaults before the headroom is computed. The global
and per-collateral caps have no fallback:

- **must be non-zero:** global epoch/period, per-collateral epoch/period
- **may be zero:** per-benefactor epoch/period — provided the corresponding global default is non-zero

A single unset global or collateral cap pins reported capacity at `0` regardless of how well funded the
custodian is.

---

## 7. Roles on the adapter

`DEFAULT_ADMIN_ROLE` assigns roles only; two-step transfer via `transferAdmin()` then `acceptAdmin()`.

| Role | Grants |
|---|---|
| `RAMP_MANAGER_ROLE` | `setOnProvider`, `setOffProvider`, `setOnRamp`, `setOffRamp` — §3 |
| `PSM_MANAGER_ROLE` | `setPsm` (re-establish benefactor registration, fees and rate limits on the new PSM **before** rotating) |
| `SWEEPER_ROLE` | `sweep()` — destinations are read from the PSM, so a compromised sweeper key cannot redirect funds |
| `RESCUE_ROLE` | `rescueTokens(token, to, amount)` — arbitrary destination, no restriction. Per the adapter's own note, this key belongs with the admin multisig only |

The adapter has no code path to `psm.setDelegatedSigner`, so a third party cannot be registered to burn
its nonces.

---

## 8. Pre-flight checklist

Everything below is a read, not prose. Run it before the first subscription and after any redeploy or
rotation on either side.

**Our side**
- [ ] `provider.externalProvider() == <adapter>`
- [ ] `provider.asset()`, `provider.liquidityToken()` match the adapter's `creditToken`/`collateralToken`
- [ ] `provider.securitizeOnRamp() == <on-ramp>`; `onRamp.assetProvider() == <provider>`
- [ ] `onRamp.custodianWallet() == <provider>`
- [ ] `provider.navProvider() == onRamp.navProvider()`
- [ ] `onRamp.twoStepTransfer() == true`
- [ ] `provider.rateTolerance()` covers the maximum expected NAV deviation from 1.00 (plus any non-zero
      PSM fee) — §5
- [ ] `onRamp.minSubscriptionAmount()` net of fee `>= 10_000` — §4
- [ ] `provider.paused() == false`; investor subscription enabled

**Counterparty side** *(cannot be set by us — verify)*
- [ ] `adapter.onProvider() == <provider>` — §3
- [ ] `adapter.onRamp() == <on-ramp>` — §3
- [ ] `BUIDL.balanceOf(assetSendCustodian)` covers expected volume
- [ ] `BUIDL.allowance(assetSendCustodian, adapter.psm())` covers expected volume — **spender is the
      PSM**, §2
- [ ] `provider.availableAsset() > 0`, and large enough for the expected batch — this single read
      collapses §2 and §6 into one check

**On a fork**
- [ ] `provider.quoteAsset(net)` returns a sane amount, and a real `swap` delivers it with no dust left
      on the on-ramp or the provider

---

## 9. Troubleshooting — errors raised by the adapter or the PSM

For errors raised by our contracts, see the protocol guide's table.

| Revert | Cause | Fix |
|---|---|---|
| `CallerNotApproved` | `adapter.onProvider()` is not our `ExternalAssetProvider`. The default state of a new deployment. | `setOnProvider` under `RAMP_MANAGER_ROLE` — §3 |
| `ReceiverNotApproved` | `adapter.onRamp()` is not our on-ramp — or single-step is delivering to an investor. | `setOnRamp`; keep two-step — §3 |
| `AmountInBelowPsmMinimum` | Net liquidity below `10_000` raw units. Can surface from a **view** (`quoteAsset`). | Raise `minSubscriptionAmount` — §4 |
| `PsmSwapDisabled` | PSM `isSwapEnabled() == false`. Note `availableAsset()` returns `0` here while the quote *reverts*, so this is **not** seen as `InsufficientAssetLiquidity`. | Ethena re-enables swaps |
| `PsmCollateralInactive` | USDC collateral unconfigured or inactive on the PSM. | Ethena registers/activates the collateral |
| `BenefactorNotActive` | Adapter is not an active PSM benefactor. | Ethena activates the benefactor |
| `InvalidAsset` | A token outside `{collateralToken, creditToken}`, or both sides equal. | Fix the token wiring |
| `AmountOutTooLow` | PSM's live quote came in below the floor our provider passed as `minAmountOut`. | Investigate PSM pricing; our floor equals the amount the investor was quoted, so it must not be lowered |
| `AmountExceedsUint128` | Net liquidity exceeds `uint128`. | Not reachable with realistic sizes; cap subscription size |
| `ZeroAmountOut` | The peg quote floored to zero. | Raise `minSubscriptionAmount` |
| `ResidualApproval` / `UnexpectedPsmOutput` | The adapter's own post-swap invariants failed — a dangling PSM approval, or PSM delivered an amount other than its quote. | Stop and escalate: this indicates unexpected PSM behaviour, not a misconfiguration |
| `InsufficientAssetLiquidity` *(ours)* | `availableAsset()` below the quote. Causes: custodian unfunded, allowance to the **PSM** missing or too small, an unset global/collateral rate-limit cap, or exhausted headroom. | §2 and §6. Do **not** deposit BUIDL into the adapter — it holds no inventory by design |
