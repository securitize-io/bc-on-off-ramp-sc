# On-Ramp ↔ Grove Basin Integration Guide

How to wire and operate the `ExternalAssetProvider` against a **real Grove Basin (PSM3)**
contract (https://github.com/grove-labs/grove-basin).

The provider lets an investor pay the liquidity token (e.g. USDC) into the
`SecuritizeOnRamp` and receive the asset (a DSToken / RWA such as BUIDL), sourcing the asset
by swapping the USDC through Grove Basin in the same transaction.

---

## 1. How `supplyTo` works

On each subscription the on-ramp settles the net liquidity (after on-ramp fee) on the provider
(`custodianWallet == address(this)`) and then calls `supplyTo(buyer, expectedAssetAmount)`. The
provider:

1. Reads its whole on-hand liquidity balance.
2. Binds the swap to the subscription: the NAV-derived asset amount for that balance must equal
   `expectedAssetAmount` (else `UnexpectedLiquidityBalanceError`).
3. Checks Grove Basin holds enough asset (`InsufficientAssetLiquidity`).
4. **Previews** the swap of the whole balance with `previewSwapExactIn(USDC, asset, balance)`.
5. **Enforces strict 1:1:** the previewed asset output must equal `expectedAssetAmount` exactly,
   otherwise it reverts with **`UnexpectedSwapOutputError(expected, quoted)`**.
6. Executes `swapExactIn(USDC, asset, balance, minAmountOut = expectedAssetAmount, buyer, referralCode)`.
   `minAmountOut` is Grove Basin's own floor, so execution slippage below `expected` reverts
   (`AmountOutTooLow`).

> ### ⚠️ Strict 1:1 is a hard requirement
> The on-ramp two-step flow forwards a **fixed** asset amount to the investor
> (`BaseOnRamp._executeAssetTransfer`). For two-step (and single-step) to deliver with **no dust
> and no revert**, Grove Basin must return **exactly** the NAV asset amount. Any divergence — a
> non-zero Grove Basin swap fee, an oracle that prices the asset off NAV, or decimal rounding —
> makes `supplyTo` revert. The inherited tolerance band (`redeemTolerance`) is therefore **not
> applied** by this provider; an exact match is stricter than any non-zero band.

This means: **you must run Grove Basin with a zero collateral→credit swap fee and an oracle that
prices the asset at exactly the Securitize NAV rate.** Sections 4–5 cover how.

---

## 2. Token wiring (must match exactly)

| Securitize term | Grove Basin term | Example |
|---|---|---|
| `liquidityToken` | `collateralToken` | USDC |
| `asset` (DSToken) | `creditToken` | BUIDL |
| — | `swapToken` | unused by this integration (kept zero / no external pocket needed) |

The provider validates this wiring at initialize / `setExternalProvider`:
- `groveBasin.collateralToken() == liquidityToken` else `CollateralTokenMismatch`
- `groveBasin.creditToken() == asset` else `CreditTokenMismatch`
- `groveBasin.pocket() != address(0)` else `PocketZeroAddressError`

The on-ramp direction is a **collateral → credit** swap (USDC in, asset out), which Grove Basin
treats as *buying credit tokens* and to which it applies its **`purchaseFee`**.

---

## 3. Prerequisites

- A deployed Grove Basin (PSM3) instance where `collateralToken` = your USDC and `creditToken` =
  your DSToken asset, with a non-zero `pocket`.
- Admin access to the relevant Grove Basin roles (`OWNER_ROLE`, `MANAGER_ADMIN_ROLE`,
  `MANAGER_ROLE`).
- The Securitize NAV provider address used by the on-ramp (the provider must price with the
  **same** NAV provider).
- Grove Basin seeded with enough `creditToken` (asset) liquidity to satisfy purchases.

---

## 4. Configure Grove Basin for strict 1:1

Perform these with the appropriate Grove Basin roles **before** the first subscription.

### 4.1 Set the collateral→credit swap (purchase) fee to ZERO  *(OWNER_ROLE)*
A purchase fee makes `previewSwapExactIn` return `expected − fee < expected` → `UnexpectedSwapOutputError`.
```solidity
// minFee must allow 0; adjust bounds first if needed (MANAGER_ADMIN_ROLE: setFeeBounds)
groveBasin.setPurchaseFee(0);
```

### 4.2 Configure rate providers so the asset prices at exactly NAV  *(MANAGER_ADMIN_ROLE)*
Grove Basin values each token in USD via its rate provider. For the USDC→asset output to equal the
Securitize NAV amount **to the wei** (after decimal adjustment):
- The **collateral (USDC)** rate provider must return exactly `1.0` USD.
- The **credit (asset)** rate provider must return the **same** price the Securitize NAV provider
  reports (`navProvider.rate()`), scaled to Grove Basin's precision (typically 1e27).
```solidity
groveBasin.setRateProvider(address(USDC),  fixedOneUsdRateProvider);
groveBasin.setRateProvider(address(asset), navMatchingRateProvider);
```
Use a `FixedRateProvider` if NAV is pegged, or an oracle adapter that tracks the same NAV source.
**Any drift between this oracle and the on-ramp's NAV provider reverts subscriptions** — keep them
synchronized.

### 4.3 Staleness threshold  *(MANAGER_ROLE)*
Ensure `stalenessThreshold` is long enough that the rate providers are never considered stale during
normal operation (a stale rate reverts the swap, surfacing as the underlying Grove Basin error).

### 4.4 Max swap size  *(MANAGER_ROLE)*
`maxSwapSize` (1e18 precision) must be ≥ the largest single subscription's USD value, or the swap
reverts (`SwapSizeExceeded`/`SwapSizeOutOfBounds`).
```solidity
groveBasin.setMaxSwapSize(<= upper bound, >= largest subscription USD value);
```

### 4.5 Pause keys  *(must be unpaused)*
The global pause (`bytes4(0)`) and the collateral→credit key
(`PAUSED_SWAP_COLLATERAL_TO_CREDIT`) must be **off**, else the swap reverts (`Paused`).

### 4.6 Seed asset liquidity
Deposit enough `creditToken` (asset) into Grove Basin (`depositInitial` once, then `deposit` by the
`liquidityProvider`) so `availableAsset()` covers expected purchases. The provider reads this via the
asset balance at the Grove Basin contract.

---

## 5. Deploy and wire the on-ramp + provider

Use the bundled Hardhat task, which deploys the provider first (so the on-ramp can be initialized
with `custodianWallet == provider`), wires both, enables two-step transfer, and enables investor
subscription.

```bash
npx hardhat deploy-on-ramp-external-asset-provider \
  --asset <DSToken address> \
  --liquidity-token <USDC address> \
  --nav-provider <Securitize NAV provider address> \
  --fee-manager <on-ramp fee manager address> \
  --grove-basin <Grove Basin / PSM3 address> \
  --network <network>
  # add --single-step to deliver straight to the investor (skips two-step)
  # add --referral-code <n> and/or --redeem-tolerance <n> if desired
```

What the task does:
1. Deploys `ExternalAssetProvider` (UUPS proxy) with `(USDC, asset, navProvider, groveBasin)` —
   validates the Grove Basin token wiring at this point.
2. Deploys `SecuritizeOnRamp` with `custodianWallet = provider`.
3. `assetProvider.setSecuritizeOnRamp(onRamp)` and `onRamp.updateAssetProvider(provider)`.
4. `onRamp.toggleTwoStepTransfer(true)` (default; omit with `--single-step`).
5. `onRamp.toggleInvestorSubscription(true)`.
6. Sanity-checks that provider and on-ramp share the same NAV provider.

> **NAV provider must match.** The provider derives the expected asset amount from its own
> `navProvider`; if it differs from the on-ramp's, the subscription binding fails
> (`UnexpectedLiquidityBalanceError`). The task warns on mismatch — do not ignore it.

---

## 6. Pre-flight checklist (before the first swap)

- [ ] `groveBasin.collateralToken() == USDC` and `creditToken() == asset`, `pocket() != 0`.
- [ ] `groveBasin.purchaseFee() == 0`.
- [ ] USDC rate provider returns 1.0; asset rate provider matches `navProvider.rate()`.
- [ ] `groveBasin.previewSwapExactIn(USDC, asset, X)` returns **exactly** the NAV asset amount for a
      representative net amount `X` (test on a fork!).
- [ ] `maxSwapSize` ≥ largest subscription USD value; rates not stale.
- [ ] Global pause and `PAUSED_SWAP_COLLATERAL_TO_CREDIT` are off.
- [ ] Grove Basin holds enough asset (`creditToken`) liquidity.
- [ ] Provider and on-ramp use the same NAV provider; two-step (or single-step) set as intended;
      investor subscription enabled.

---

## 7. Two-step vs single-step

- **Two-step (default, RWA compliance):** asset goes Grove Basin → on-ramp → investor. The on-ramp
  forwards the fixed `expectedAssetAmount`; the strict 1:1 check guarantees the on-ramp received
  exactly that, so there is no dust and no shortfall.
- **Single-step:** asset goes Grove Basin → investor directly. Strict 1:1 still applies, so the
  investor receives exactly the NAV amount.

Both modes rely on the same strict-equality guarantee; the configuration above is identical.

---

## 8. Troubleshooting (revert → cause → fix)

| Revert | Cause | Fix |
|---|---|---|
| `UnexpectedSwapOutputError(expected, quoted)` | Grove Basin would deliver a different asset amount than NAV (most often a non-zero `purchaseFee` or an oracle off NAV). | Set `purchaseFee = 0`; align the asset rate provider with the NAV rate; check decimals. |
| `AmountOutTooLow` (from Grove Basin) | Execution delivered less than `expected` between preview and swap (rate moved / slippage). | Stabilize the oracle; ensure preview and execution price are consistent within the block. |
| `UnexpectedLiquidityBalanceError(expected, actual)` | On-hand USDC doesn't match the subscription (donated/stuck liquidity, or NAV provider mismatch between provider and on-ramp). | Don't pre-fund the provider; ensure provider and on-ramp share the same NAV provider. |
| `InsufficientAssetLiquidity(requested, available)` | Grove Basin lacks asset to fulfill the purchase. | Seed more `creditToken` liquidity into Grove Basin. |
| `ZeroAmountToSwap` | Provider holds no USDC when `supplyTo` runs. | Ensure `custodianWallet == provider` so the on-ramp settles net USDC there first. |
| `CollateralTokenMismatch` / `CreditTokenMismatch` / `PocketZeroAddressError` | Grove Basin wiring doesn't match this integration. | Point at a Grove Basin whose `collateralToken`/`creditToken`/`pocket` match. |
| `Paused` / `SwapSizeExceeded` / `StaleRate` (from Grove Basin) | Pause flag set, swap too large, or stale oracle. | Unpause the relevant key; raise `maxSwapSize`; refresh the oracle / staleness threshold. |

---

## 9. Why a real Grove Basin needs careful setup

Because this provider enforces **strict 1:1**, it is only operable against a Grove Basin configured
with **no collateral→credit swap fee** and an **oracle pinned to the Securitize NAV**. This is a
deliberate design choice so the two-step on-ramp can forward a fixed amount with zero dust. If your
deployment cannot guarantee a fee-free, NAV-pinned Grove Basin, raise it with the protocol team
before going live — the alternative designs (forwarding the actual swapped amount) require changes
to the shared on-ramp contracts and were intentionally not adopted here.
