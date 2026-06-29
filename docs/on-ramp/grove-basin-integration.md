# On-Ramp ↔ Grove Basin Integration Guide

How to wire and operate the `ExternalAssetProvider` + `ExternalAssetProviderOnRamp` against a
**real Grove Basin (PSM3)** contract (https://github.com/grove-labs/grove-basin).

The flow lets an investor pay the liquidity token (e.g. USDC) into the on-ramp and receive the asset
(a DSToken / RWA such as BUIDL), sourcing the asset by swapping the USDC through Grove Basin in the
same transaction.

---

## 1. How it works

`ExternalAssetProviderOnRamp` is a `SecuritizeOnRamp` that overrides one thing: it **quotes the asset
amount from Grove Basin** (`previewSwapExactIn` over the net liquidity) instead of from the Securitize
NAV. Per subscription:

1. The on-ramp pulls the gross liquidity from the investor, sends the **Securitize fee** to the fee
   collector, and settles the **net** liquidity on the provider (`custodianWallet == provider`).
2. `calculateDsTokenAmount` sizes `dsTokenAmount = provider.quoteAsset(net)` — the Grove Basin
   exact-in quote for the net.
3. The on-ramp calls `provider.supplyTo(buyer, dsTokenAmount)`. The provider:
   - re-quotes `previewSwapExactIn(USDC, asset, balance)` and requires it to equal `dsTokenAmount`
     (rejects donated/stuck liquidity → `UnexpectedSwapOutputError`);
   - **cross-checks** that quote against the Securitize NAV within the tolerance band
     (`redeemTolerance`, default 1%) → `MinRateDivergenceError` / `MaxRateDivergenceError`;
   - executes `swapExactIn(USDC, asset, balance, minAmountOut = dsTokenAmount, buyer, referralCode)`.

Because the on-ramp and the provider quote from the **same** Grove Basin preview in the same
transaction, the amount the on-ramp forwards equals what Grove Basin delivers — **by construction**.

> ### Key property
> The investor receives the **actual Grove Basin output**, which may differ from the Securitize NAV
> amount by up to `redeemTolerance` (default ±1%). The NAV is kept as an independent **sanity band**:
> a Grove Basin quote diverging beyond the band reverts, so a manipulated/stale Grove Basin oracle
> cannot price the swap arbitrarily.

### Why this design (vs. requiring an exact 1:1 quote)
An earlier design required Grove Basin to return *exactly* the NAV amount, which reverted on any
Grove Basin fee or oracle drift. Quoting from Grove Basin removes that fragility while keeping the
NAV band as protection — and it does so **without changing the shared on-ramp transfer plumbing**
(`BaseOnRamp`, `IAssetProvider`, or the sibling providers).

---

## 2. one-step and two-step both work

- **two-step (default, RWA compliance):** asset goes Grove Basin → on-ramp → investor. The on-ramp
  forwards `dsTokenAmount`, which equals the delivered amount, so **no dust and no shortfall**.
- **single-step:** asset goes Grove Basin → investor directly. Same quote, delivered straight.

Both modes rely on the same Grove-Basin-sourced quote; configuration is identical.

---

## 3. Securitize fees are charged before Grove Basin

Fee handling is unchanged and happens **before** any Grove Basin call, in
`BaseOnRamp._executeLiquidityTransfer`:

1. Pull gross liquidity from the investor.
2. Send the Securitize fee (`feeManager.getFee(gross)`) to the fee collector.
3. Settle only the **net** (`gross − fee`) on the provider.
4. The provider swaps the **net** through Grove Basin.

The quote (`quoteAsset`) is computed on the same **net**, so the asset amount matches the liquidity
actually swapped. You can run any Securitize fee independently of Grove Basin's own fee.

---

## 4. Token wiring (must match exactly)

| Securitize term | Grove Basin term | Example |
|---|---|---|
| `liquidityToken` | `collateralToken` | USDC |
| `asset` (DSToken) | `creditToken` | BUIDL |
| — | `swapToken` | unused by this integration |

Validated by the provider at initialize / `setExternalProvider`:
- `collateralToken() == liquidityToken` else `CollateralTokenMismatch`
- `creditToken() == asset` else `CreditTokenMismatch`
- `pocket() != address(0)` else `PocketZeroAddressError`

The on-ramp direction is a **collateral → credit** swap (USDC in, asset out), which Grove Basin
treats as *buying credit tokens* and to which it applies its **`purchaseFee`**.

---

## 5. Configure Grove Basin

Perform with the appropriate Grove Basin roles before the first subscription.

### 5.1 Rate providers / oracle  *(MANAGER_ADMIN_ROLE)*
Grove Basin values each token in USD via its rate provider. The **asset (credit) price must stay
within `redeemTolerance` of the Securitize NAV** for swaps to pass the band; the **collateral (USDC)**
rate provider should return ~1.0 USD.
```solidity
groveBasin.setRateProvider(address(USDC),  usdRateProvider);     // ~1.0 USD
groveBasin.setRateProvider(address(asset), navTrackingRateProvider); // tracks NAV within the band
```
The further the Grove Basin oracle drifts from NAV, the closer you get to the band edge; beyond it,
subscriptions revert with `Min/MaxRateDivergenceError`. Tune `redeemTolerance` on the provider
(`setRedeemTolerance`) to your acceptable divergence.

### 5.2 Purchase fee  *(OWNER_ROLE)*
A non-zero `purchaseFee` is **allowed** — the investor simply receives the post-fee amount, as long
as the total NAV/Grove Basin divergence stays within the band. Size the fee with the band in mind.
```solidity
groveBasin.setPurchaseFee(<bps within the tolerance budget>);
```

### 5.3 Staleness threshold  *(MANAGER_ROLE)*
Keep `stalenessThreshold` long enough that rate providers are never stale during normal operation
(a stale rate reverts the swap).

### 5.4 Max swap size  *(MANAGER_ROLE)*
`maxSwapSize` (1e18 precision) must be ≥ the largest single subscription's USD value, else the swap
reverts (`SwapSizeExceeded` / `SwapSizeOutOfBounds`).

### 5.5 Pause keys  *(must be unpaused)*
The global pause (`bytes4(0)`) and the collateral→credit key (`PAUSED_SWAP_COLLATERAL_TO_CREDIT`)
must be off.

### 5.6 Seed asset liquidity
Deposit enough `creditToken` (asset) into Grove Basin (`depositInitial` once, then `deposit` by the
`liquidityProvider`) so `availableAsset()` covers expected purchases.

---

## 6. Deploy and wire

Use the bundled Hardhat task. It deploys the provider first (so the on-ramp can be initialized with
`custodianWallet == provider`), deploys **`ExternalAssetProviderOnRamp`**, wires both, enables
two-step, and enables investor subscription.

```bash
npx hardhat deploy-on-ramp-external-asset-provider \
  --asset <DSToken address> \
  --liquidity-token <USDC address> \
  --nav-provider <Securitize NAV provider address> \
  --fee-manager <on-ramp fee manager address> \
  --grove-basin <Grove Basin / PSM3 address> \
  --network <network>
  # --single-step to deliver straight to the investor (skips two-step)
  # --referral-code <n> and/or --redeem-tolerance <n> if desired
```

> **NAV provider must match.** The provider's NAV band cross-check uses its own `navProvider`; it
> must equal the on-ramp's. The task warns on mismatch — do not ignore it.

---

## 7. Pre-flight checklist

- [ ] `collateralToken() == USDC`, `creditToken() == asset`, `pocket() != 0`.
- [ ] Asset rate provider tracks the Securitize NAV within `redeemTolerance`; USDC rate ~1.0.
- [ ] `purchaseFee` (if any) + oracle drift stays inside the band.
- [ ] On a fork, `provider.quoteAsset(net)` returns a sane amount and a real `swap` delivers it with
      no dust on the on-ramp/provider.
- [ ] `maxSwapSize` ≥ largest subscription USD value; rates not stale.
- [ ] Global pause and `PAUSED_SWAP_COLLATERAL_TO_CREDIT` are off.
- [ ] Grove Basin holds enough asset (`creditToken`) liquidity.
- [ ] Provider and on-ramp share the same NAV provider; transfer mode and investor subscription set.

---

## 8. Troubleshooting (revert → cause → fix)

| Revert | Cause | Fix |
|---|---|---|
| `MinRateDivergenceError` / `MaxRateDivergenceError` | Grove Basin quote diverges from the Securitize NAV beyond `redeemTolerance`. | Align the asset rate provider with NAV; reduce `purchaseFee`; or widen `redeemTolerance` (deliberately). |
| `UnexpectedSwapOutputError(expected, quoted)` | On-hand balance isn't exactly this subscription's net (donated/stuck liquidity, or NAV/quote provider mismatch between on-ramp and provider). | Don't pre-fund the provider; ensure provider and on-ramp use the same NAV provider and Grove Basin. |
| `AmountOutTooLow` (from Grove Basin) | Execution delivered less than the quoted floor between preview and swap. | Stabilize the oracle so preview and execution agree within the block. |
| `InsufficientAssetLiquidity(requested, available)` | Grove Basin lacks asset to fulfill the purchase. | Seed more `creditToken` liquidity. |
| `ZeroAmountToSwap` | Provider holds no USDC when `supplyTo` runs. | Ensure `custodianWallet == provider`. |
| `NonZeroNavRateError` | Securitize NAV rate is zero (band cross-check can't run). | Fix the NAV provider. |
| `CollateralTokenMismatch` / `CreditTokenMismatch` / `PocketZeroAddressError` | Grove Basin wiring doesn't match. | Point at a correctly wired Grove Basin. |
| `Paused` / `SwapSizeExceeded` / `StaleRate` (from Grove Basin) | Pause flag set, swap too large, or stale oracle. | Unpause; raise `maxSwapSize`; refresh oracle / staleness threshold. |

---

## 9. Summary

`ExternalAssetProviderOnRamp` quotes the asset from Grove Basin so the two-step on-ramp forwards
exactly what the swap delivers — no dust, no benign-divergence reverts — while the Securitize NAV
remains an independent ±`redeemTolerance` sanity band. Securitize fees are charged on the gross
before Grove Basin is called, and only the net is swapped. Both one-step and two-step are supported
with the same configuration.
