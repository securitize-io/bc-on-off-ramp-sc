# Third Party Off-Ramp (Grove Basin Integration)

Technical reference for the third-party off-ramp module that redeems a Securitize RWA
asset (a DSToken, e.g. BUIDL) for a liquidity token (a stablecoin, e.g. USDC) by routing
an atomic swap through the third-party **Grove Basin (PSM3)** protocol.

## Module scope

| File | Role |
| --- | --- |
| `contracts/off-ramp/ThirdPartyOffRamp.sol` | Self-service off-ramp. Any RWA token holder can redeem directly. Orchestrates the redemption, computes the NAV expectation, and enforces the tolerance band. |
| `contracts/off-ramp/IThirdPartyOffRamp.sol` | External interface for `ThirdPartyOffRamp` (events, errors, getters). |
| `contracts/off-ramp/provider/GroveBasinLiquidityProvider.sol` | Liquidity provider that performs the asset → liquidity token swap through Grove Basin. |
| `contracts/off-ramp/provider/IThirdPartyLiquidityProvider.sol` | External interface for `GroveBasinLiquidityProvider`. |
| `contracts/off-ramp/third-party-contracts/IGroveBasin.sol` | Minimal interface for the external Grove Basin (PSM3) contract. |

Supporting shared code (not specific to this module): `BaseOffRamp`, `RedemptionManager`,
`TokenCalculator`, `ILiquidityProvider`, `common/Errors.sol`.

> Nomenclature: `asset` always refers to the DSToken / RWA token, and `liquidityToken`
> always refers to the fiat-pegged stablecoin used for settlement.

---

## Architecture overview

```
                 (1) redeem(assetAmount, minOut)
 Investor ───────────────────────────────────────────────► ThirdPartyOffRamp
                                                                 │
                          (2) two-step redemption via _redeem()  │
                                                                 ▼
   investor ──asset──► ThirdPartyOffRamp ──asset──► GroveBasinLiquidityProvider
                                                                 │
                                       (3) supplyTo(): swapExactIn│
                                                                 ▼
                                                            Grove Basin (PSM3)
                                                       asset ─► pocket() custody
                                                       liquidityToken ─► off-ramp
                                                                 │
                          (4) off-ramp delivers net liquidity    │
   investor ◄──liquidityToken (net)── ThirdPartyOffRamp ◄────────┘
   feeCollector ◄──liquidityToken (fee)──┘

                          (5) _validateRedeemTolerance(): NAV band check
```

The contracts are **UUPS upgradeable proxies** (`ThirdPartyOffRamp` extends `BaseOffRamp`;
`GroveBasinLiquidityProvider` extends `BaseContract`). Neither contract custodies the asset
or the liquidity token beyond the duration of a single `redeem` transaction.

---

## `ThirdPartyOffRamp`

Self-service off-ramp. Any RWA token holder can call `redeem` directly without needing a
special role. It only supports the **two-step transfer flow** (`twoStepTransfer = true`);
single-step redemption reverts with `OneStepRedemptionNotSupportedError`. Asset burning is
not supported (`AssetBurnNotSupportedError`) because the asset is the swap input.

### Storage / constants

| Name | Type | Description |
| --- | --- | --- |
| `NAME` / `VERSION` | `string` constant | `"ThirdPartyOffRamp"` / `"1"`. |
| `TOLERANCE_DENOMINATOR` | `uint256` constant | `100_000`. Represents `100%` (`1_000 == 1%`). |
| `DEFAULT_REDEEM_TOLERANCE` | `uint256` constant | `0`. Exact NAV match required until reconfigured. |
| `navProvider` | `ISecuritizeNavProvider` | Securitize NAV rate provider used to compute the expected output. |
| `redeemTolerance` | `uint256` | Tolerance applied to the NAV expectation, scaled to `TOLERANCE_DENOMINATOR`. |

### Initialization

```solidity
function initialize(address _asset, address _navProvider, address _feeManager, bool _assetBurn)
```

- Reverts with `AssetBurnNotSupportedError` if `_assetBurn == true`.
- Reverts via `addressNonZero` if `_navProvider` is the zero address.
- Sets `redeemTolerance = DEFAULT_REDEEM_TOLERANCE` (`0`) and `twoStepTransfer = true`.

> The `initialize` signature is fixed by `IBaseOffRamp` and shared with the other off-ramps.
> The redeem tolerance is therefore configured **after** deployment via `setRedeemTolerance`
> (the deploy task exposes an optional `--redeem-tolerance` flag for this).

### Redemption flow — `redeem`

```solidity
function redeem(uint256 _assetAmount, uint256 _minOutputAmount)
    external whenNotPaused
```

The caller (`msg.sender`) must be the RWA token holder: they must hold at least
`_assetAmount` of the asset and must have granted this contract an ERC-20 allowance over it
before calling.

1. Requires `twoStepTransfer == true`, otherwise `OneStepRedemptionNotSupportedError`.
2. Reads `navProvider.rate()`; reverts `NonZeroNavRateError` if zero.
3. Calls the shared `_redeem(...)` (from `BaseOffRamp` → `RedemptionManager.executeTwoStepRedemption`):
   - Pulls the asset from the caller into the off-ramp, then forwards it to the
     liquidity provider's `recipient()`.
   - Calls `liquidityProvider.supplyTo(...)` which swaps the asset for the liquidity token.
   - Computes `fee` on the **delivered** amount and applies the **slippage guard**
     (`SlippageControlError` if `netDelivered < _minOutputAmount`).
   - Delivers the net liquidity token to the caller and the fee to the fee collector.
4. Calls `_validateRedeemTolerance(_assetAmount, liquidityValue)` (see below).
5. Emits `RedemptionCompleted` and `GroveBasinRedemption`.

### NAV tolerance band — `_validateRedeemTolerance`

Because Grove Basin uses its **own** pricing/NAV and Securitize uses its **own** NAV
provider, the delivered amount is validated against an acceptable band around the
Securitize NAV expectation.

```solidity
expected     = calculateLiquidityTokenAmount(_assetAmount); // net (after fee), from our NAV
maxTolerable = expected * (TOLERANCE_DENOMINATOR + redeemTolerance) / TOLERANCE_DENOMINATOR;
minTolerable = expected * (TOLERANCE_DENOMINATOR - redeemTolerance) / TOLERANCE_DENOMINATOR;

if (liquidityValue > maxTolerable) revert RedeemMaxToleranceExceededError(liquidityValue, maxTolerable);
if (liquidityValue < minTolerable) revert RedeemMinToleranceExceededError(liquidityValue, minTolerable);
```

- The comparison is **net vs. net**: both `liquidityValue` and `expected` are after fee, so
  the band isolates the NAV divergence and is not distorted by the fee.
- Tolerance scale: `100_000 == 100%`, `5_000 == 5%`, `1_000 == 1%`.
- Example: `redeemTolerance = 5_000` (5%), `expected = 100` → accepted band `[95, 105]`.
  A delivered value of `90` reverts with `RedeemMinToleranceExceededError(90, 95)`.

#### `setRedeemTolerance`

```solidity
function setRedeemTolerance(uint256 _tolerance) external onlyRole(DEFAULT_ADMIN_ROLE)
```

Reverts with `InvalidToleranceError(_tolerance)` if `_tolerance > TOLERANCE_DENOMINATOR`.
Emits `RedeemToleranceUpdated(old, new)`.

#### Interaction with the slippage guard

The per-call `_minOutputAmount` (slippage) and the `minTolerable` bound both protect the
downside, but the **slippage guard runs first** inside `_redeem`. If the caller passes
`_minOutputAmount >= minTolerable`, a shortfall reverts with `SlippageControlError` before
the tolerance check is reached. To exercise `RedeemMinToleranceExceededError`, set
`_minOutputAmount` low enough (e.g. `0`) so the slippage guard passes. The upper bound
(`RedeemMaxToleranceExceededError`) is always evaluated, since slippage does not cap the
upside.

### Quotes (views)

| Function | Returns |
| --- | --- |
| `calculateLiquidityTokenAmountBeforeFee(assetAmount)` | NAV-derived liquidity amount **before** fee. |
| `calculateLiquidityTokenAmount(assetAmount)` | NAV-derived liquidity amount **after** fee (the tolerance reference). |

Both revert with `NonZeroNavRateError` if the NAV rate is zero and require a configured
liquidity provider (`nonZeroLiquidityProvider`).

### Events

- `RedemptionCompleted(investor, assetAmount, liquidityValue, rate, fee, liquidityToken)` (from `BaseOffRamp`).
- `GroveBasinRedemption(investor, assetAmountIn, liquidityAmountOut, redeemer)` — `redeemer` is `msg.sender` (same as `investor` in the self-service flow).
- `RedeemToleranceUpdated(oldTolerance, newTolerance)`.
- `NavProviderUpdated(oldProvider, newProvider)`.

### Errors

| Error | Cause |
| --- | --- |
| `OneStepRedemptionNotSupportedError` | `redeem` called while `twoStepTransfer == false`. |
| `AssetBurnNotSupportedError` | `initialize` called with `_assetBurn == true`. |
| `InvalidToleranceError(tolerance)` | `setRedeemTolerance` with `tolerance > 100_000`. |
| `RedeemMaxToleranceExceededError(liquidityValue, maxTolerable)` | Delivered value above the band. |
| `RedeemMinToleranceExceededError(liquidityValue, minTolerable)` | Delivered value below the band. |
| `NonZeroNavRateError` | NAV rate is zero. |
| `SlippageControlError` | Net delivered `< _minOutputAmount` (raised in `RedemptionManager`). |

---

## `GroveBasinLiquidityProvider`

Liquidity provider that, on each redemption, swaps the asset it just received for the
liquidity token through Grove Basin at a strict 1:1 peg and forwards the proceeds to the
off-ramp in the same transaction. `recipient()` resolves to the provider itself so the
two-step flow transfers the asset here right before calling `supplyTo`.

### Storage

| Name | Type | Description |
| --- | --- | --- |
| `liquidityToken` | `IERC20Metadata` | Stablecoin delivered to the redeemer. |
| `assetToken` | `IERC20Metadata` | Asset swapped into Grove Basin (derived from the off-ramp). |
| `securitizeOffRamp` | `IBaseOffRamp` | The only contract authorized to call `supplyTo`. |
| `groveBasin` | `IGroveBasin` | External Grove Basin (PSM3) contract. |
| `recipient` | `address` | `address(this)`; the asset is transferred here to be swapped. |
| `referralCode` | `uint256` | Referral code forwarded to Grove Basin. |

### `supplyTo`

```solidity
function supplyTo(address _receiver, uint256 _minOut)
    external whenNotPaused onlySecuritizeRedemption returns (uint256 amountOut)
```

1. `amountIn = assetToken.balanceOf(address(this))`; reverts `ZeroAmountToSwap` if zero.
2. **Pocket check**: reverts `PocketZeroAddressError` if `getLiquidityCustodian()` resolves to
   `address(0)`. The pocket is read fresh on every call because Grove Basin is a third-party
   contract whose configuration may change at any time.
3. Reverts `InsufficientLiquidity(_minOut, available)` if `_minOut > _availableLiquidity()`.
4. `forceApprove` the asset to Grove Basin and call `swapExactIn(...)`, sending the
   liquidity token to `_receiver` (the off-ramp).

> `_availableLiquidity()` reports `liquidityToken.balanceOf(getLiquidityCustodian())`. Grove
> Basin custodies the swap token (our liquidity token, e.g. USDC) in its `pocket`, which defaults
> to `address(groveBasin)` until a manager configures an external pocket. This is a best-effort
> pre-check; the hard guarantee is Grove Basin reverting the swap when its pool cannot satisfy
> the requested output.

### Admin / views

- `setGroveBasin(address)` — `DEFAULT_ADMIN_ROLE`; reverts `NonZeroAddressError` on zero; emits `GroveBasinUpdated`.
- `setReferralCode(uint256)` — `DEFAULT_ADMIN_ROLE`; emits `ReferralCodeUpdated`.
- `getLiquidityCustodian()` — wallet whose liquidity-token balance reflects swapable liquidity in Grove Basin (Grove Basin `pocket()`); reverts `PocketZeroAddressError` when unset.
- `availableLiquidity()` — `liquidityToken.balanceOf(getLiquidityCustodian())`.
- `calculateEffectiveLiquidityTokenAmount(amount)` — returns `amount` (strict 1:1 peg).

### Errors

| Error | Cause |
| --- | --- |
| `RedemptionUnauthorizedAccount(account)` | `supplyTo` caller is not the off-ramp. |
| `PocketZeroAddressError` | `groveBasin.pocket()` is the zero address at swap time. |
| `ZeroAmountToSwap` | No asset balance to swap. |
| `InsufficientLiquidity(requested, available)` | Requested output exceeds Grove Basin balance. |
| `NonZeroAddressError` | Zero address passed to `initialize` / `setGroveBasin`. |

---

## `IGroveBasin` (external protocol)

Minimal interface for the external Grove Basin (PSM3) contract. Only the functions this
project relies on are declared:

- `swapExactIn(assetIn, assetOut, amountIn, minAmountOut, receiver, referralCode)` — performs the swap.
- `previewSwapExactIn(assetIn, assetOut, amountIn)` — quotes the output.
- `pocket()` — wallet that custodies the swap liquidity. Grove Basin pulls the swapped-in
  asset into the pocket and pushes the swapped-out liquidity token from it, so it must hold a
  sufficient balance and be a non-zero address.

Reference: https://github.com/grove-labs/grove-basin

---

## Platform wallet configuration (DSToken compliance)

The asset is a **DSToken** that enforces transfer-restriction and compliance hooks: a
transfer is only permitted between registered investors **or** addresses that are
registered as **platform wallets** in the token's `WalletManager` service. Because the
redemption moves the asset across several protocol-owned addresses, **each of the following
must be added as a platform wallet** in the RWA DSToken, or the redemption will revert
inside the DSToken compliance checks:

| Address | Why it must be a platform wallet |
| --- | --- |
| **OffRamp** (`ThirdPartyOffRamp` proxy) | Receives the asset pulled from the investor during the two-step flow. |
| **LiquidityProvider** (`GroveBasinLiquidityProvider` proxy) | Receives the asset (as `recipient()`) right before the swap. |
| **GroveBasin `pocket()`** | Final custodian of the swapped-in asset (the DSToken ends up held by the pocket). |
| **FeeCollector** (fee manager collector) | Configured as a platform wallet for fee settlement. |

> The fee collector is frequently configured already as part of another protocol; in that
> case `addPlatformWallet` reverts with `Direct wallet type change is not allowed`, which is
> expected and can be ignored.

### Resolving the `WalletManager` and registering wallets

The `WalletManager` is resolved from the DSToken via its DS service registry
(service id `32`). Example against the Securitize DSToken repository:

```sh
cd src/dstoken
npx hardhat console --network sepolia

const dsToken = await ethers.getContractAt("DSToken", "0xeccA2c5D73CF7bf8eA14DC7764f6F37C814B50b8");
await dsToken.getDSService(32);
// '0xF887ABA7273516f98E48ba8E6E9034FEE60077b3'  (WalletManager)

const walletManager = await ethers.getContractAt("WalletManager", "0xF887ABA7273516f98E48ba8E6E9034FEE60077b3");

// OffRamp
await walletManager.addPlatformWallet("0xbfed231a736eA5e3F2d57179081Ba74FB6552679");
// txHash: 0xfdff7b6a4382e366612734e435ff44c934d77d76f2f2495990533c684330e980

// GroveBasin pocket
await mockGroveBasin.pocket();
// '0x7B99D31a4A05bCC1DDD2A013C52fd20445D57fAB'
await walletManager.addPlatformWallet("0x7B99D31a4A05bCC1DDD2A013C52fd20445D57fAB");
// txHash: 0x93a8fa605717f0d3fb5a741ac86da1e843c87fcc9a493e22331bc434c410bb0c

// LiquidityProvider
await walletManager.addPlatformWallet("0x30AF2f941840B44fD2b2b9AA94C6F496ba3F3E2c");
// txHash: 0xb2ad14e69101ca897f048ab165350467389c58c196bc6052ca18a3d4eb945e37

// FeeManager collector (already configured)
await walletManager.addPlatformWallet("0x81a1AF23E96DaC759BF567d6Aa67FcF8DACaa7fb");
// Uncaught ProviderError: execution reverted: Direct wallet type change is not allowed
```

> If `pocket()` is ever changed on the Grove Basin side, the **new** pocket address must be
> registered as a platform wallet before any further redemption.

---

## Deployment

```sh
npx hardhat deploy-third-party-protocol \
  --network sepolia \
  --asset {dsToken} \
  --nav-provider {navProvider} \
  --fee-manager {feeManager} \
  --liquidity-token {liquidityToken} \
  --grove-basin {groveBasinContract} \
  --operator {operator} \
  [--redeem-tolerance {0..100000}]
```

The task deploys both proxies, links the liquidity provider to the off-ramp, optionally sets
the redeem tolerance, and grants `OPERATOR_ROLE` to `--operator` (reserved for admin
operations; `redeem` itself is open to any RWA token holder). After deployment, register
the platform wallets as described above before enabling redemptions.

---

## Testing

```sh
npx hardhat test test/off-ramp/third-party-off-ramp.test.ts
```

The suite covers creation/initialization, access control, pausing, quotes, available
liquidity, the redemption happy path, the `PocketZeroAddressError` path, decimal variants,
and the full redeem-tolerance matrix (band success/failure with and without a non-zero fee).
`MockGroveBasin.setOutputFactor(numerator, denominator)` is used to simulate a Grove Basin
NAV that diverges from the 1:1 peg.

### Decoding custom errors in the console

Hardhat's console renders unrecognized custom errors as the raw 4-byte selector interpreted
as text (e.g. `execution reverted: lÊb` is the selector `0x6cca9a62` = `SlippageControlError()`).
To decode it, use a static call and the contract interface:

```js
try {
  await offRamp.redeem.staticCall(assetAmount, 0);
} catch (e) {
  const data = e.data ?? e.info?.error?.data;
  console.log(offRamp.interface.parseError(data));
}
```
