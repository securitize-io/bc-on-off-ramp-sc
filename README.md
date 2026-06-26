# README

<img src="https://s3.us-east-2.amazonaws.com/securitize-public-files/securitize_logo+medium.png" alt="Securitize" width="200px"/>

# Securitize On/Off Ramp Protocol

### What is this repository for?

This protocol allows investor to subscribe/buy Securitize RWA

#### On Ramp

Securitize on ramp protocol allows investor to purchase digital securities.

### 1. `subscribe`

- **Description**: This is a permissioned method meant for verified investors.
- **Mechanism**:
    - Executed using a signed payload compliant with the [EIP-712](https://eips.ethereum.org/EIPS/eip-712) standard.
    - The platform backend generates and signs the request after validating all parameters.
- **Security**: Ensures access control via signature validation.

### 3. `swap`

- **Description**: Investors specify the amount of liquidity they want to use to purchase RWA tokens.
- **Parameters**: token amount and slippage tolerance.
- **Mechanism**:
    - The contract computes the equivalent number of tokens to issue using the current NAV rate.
- **Use Case**: Budget-constrained purchases with token output calculated.

##### Asset providers (`IAssetProvider`)

The on-ramp sources the asset delivered to the investor through a pluggable asset provider:

- `AllowanceAssetProvider`: transfers the asset from a funded wallet that approved the provider.
- `MintingAssetProvider`: mints the asset (requires the `ISSUER` role on the DSToken).
- `ExternalAssetProvider`: swaps the investor's liquidity token (USDC) for the asset
  (e.g. BUIDL) through Grove Basin (PSM3) at a strict 1:1 peg, with NAV-divergence protection.

###### Securitize On-Ramp with Grove Basin Asset Provider

`ExternalAssetProvider` pairs `SecuritizeOnRamp` with Grove Basin so an investor can buy an RWA
asset by paying USDC, without the protocol maintaining an asset inventory of its own.

**USDC flow:** `investor → SecuritizeOnRamp → (fee → feeCollector) → net → ExternalAssetProvider
→ Grove Basin`. Grove Basin keeps the USDC and delivers the asset (to the on-ramp in two-step, or
to the investor in single-step). The provider holds **no USDC treasury**: the exact-output swap is
sized so the whole on-hand balance is consumed, and any residual reverts the call
(`LiquidityNotFullyConsumed`).

**No changes to the core on-ramp:** `SecuritizeOnRamp`/`BaseOnRamp` are untouched. The provider is
self-contained — it prices the swap with its own NAV provider (the same one the on-ramp uses) and
never calls back into the on-ramp.

**Custodian wiring — mandatory:** the net USDC must settle on the provider before the swap, so the
on-ramp is **initialized** with `custodianWallet == ExternalAssetProvider` (no on-ramp setter). To
avoid a circular dependency the deploy task deploys the **provider first**, initializes the on-ramp
with `custodianWallet = provider`, then calls `provider.setSecuritizeOnRamp(onRamp)` to authorize
the caller.

**Transfer mode — two-step by default (RWA compliance):** the deploy task enables **two-step**
(`twoStepTransfer = true`) by default: the asset is swapped to the on-ramp and then sent to the
investor, so the DSToken reaches the investor from the whitelisted on-ramp address — required by RWA
tokens with transfer compliance rules. Pass `--single-step` to deliver the asset straight from Grove
Basin to the investor instead (only when Grove Basin is an allowed DSToken sender).

**`swapExactOut` (not `swapExactIn`):** the on-ramp two-step flow transfers a **fixed** amount
(`dsTokenAmount` from the NAV) to the investor, so the provider must deliver **exactly** that amount.
`swapExactOut(amountOut = dsTokenAmount)` guarantees it (no revert, no stranded dust on the on-ramp).
`swapExactIn` would deliver a market amount that rarely matches and would break the fixed transfer.
The trade-off: in the strict 1:1 product Grove Basin consumes exactly the net USDC; under divergence
the call fails safe (`AmountInTooHigh` if it needs more than the net, `LiquidityNotFullyConsumed` if
it would leave a residual) rather than retaining funds.

**NAV-divergence protection:** the provider binds the operation to the current subscription
(rejecting donated/stuck USDC via `UnexpectedLiquidityBalanceError`) and compares the NAV-implied
input against the Grove Basin `previewSwapExactOut`, reverting beyond `redeemTolerance`
(default 1%, denominator `100_000`) with `Min`/`MaxRateDivergenceError`.

**Grove Basin token wiring:** the `--liquidity-token` argument must match Grove Basin's `collateralToken`
(USDC) and the `--asset` argument must match Grove Basin's `creditToken` (the RWA asset). This is
the same wiring as the off-ramp `ExternalLiquidityProvider`; both share the
`BaseExternalGroveBasinProvider` base contract.

```sh
npx hardhat deploy-on-ramp-external-asset-provider --network arbitrum --asset {dsToken} --liquidity-token {liquidityToken} --nav-provider {navProvider} --fee-manager {feeManager} --grove-basin {groveBasinContract}
```

After deployment, enable `investorSubscriptionEnabled` before the first headless `swap`, and make
sure Grove Basin holds enough asset (`creditToken`) to satisfy purchases.

#### Off Ramp

Securitize off ramp protocol allows investor to redeem their digital securities by stable coins

Project was thought to have several implementations in order to supply stable coins (ILiquidityProvider).
Currently, we have just one implementation, in order to extend functionality in the future we must extend ILiquidityProvider interface

Securitize redemption protocol uses a NAV rate provider. The internal implementation of Securitize can be found here
[https://bitbucket.org/securitize_dev/bc-nav-provider-sc](https://bitbucket.org/securitize_dev/bc-nav-provider-sc)

- Version 0.0.1

### How do I get set up?

- Install dependencies

```sh
npm install
```

- Compile smart contracts

```sh
npm run compile
```

### Deploy

#### Fee Manager

```sh
npx hardhat deploy-mbps-fee-manager --network arbitrum --mbps 2000 --collector {feeCollectorAddress}
```

#### On Ramp

```sh
npx hardhat deploy-on-ramp --network arbitrum --token {dsToken} --liquidity {liquidityToken} --nav {navProvider} --fee {feeManager} --custodian {custodian} --type ALLOWANCE --provider {allowanceProviderWallet}
```

#### On Ramp (Grove Basin External Asset Provider)

```sh
npx hardhat deploy-on-ramp-external-asset-provider --network arbitrum --asset {dsToken} --liquidity-token {liquidityToken} --nav-provider {navProvider} --fee-manager {feeManager} --grove-basin {groveBasinContract}
```

#### Public Stock On Ramp

```sh
npx hardhat deploy-public-stock-on-ramp --network arbitrum --token {dsToken} --liquidity {liquidityToken} --nav {navProvider} --fee {feeManager} --custodian {custodian} --type {ALLOWANCE|MINTING} --provider {allowanceProviderWallet}
```

#### Off Ramp

##### Allowance Implementation

```sh
npx hardhat deploy-redemption-allowance-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet}
```

##### Collateral Implementation

```sh
npx hardhat deploy-redemption-collateral-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet} --external-collateral-redemption {externalCollateralRedemption}
```

##### Public Stock Off Ramp (Allowance)

```sh
npx hardhat deploy-public-stock-offramp-allowance-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet} --verify
```

##### Public Stock Off Ramp (Collateral)

```sh
npx hardhat deploy-public-stock-offramp-collateral-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet} --external-collateral-redemption {externalCollateralRedemption} --verify
```

##### Securitize Off-Ramp with Grove Basin Liquidity Provider

This combination pairs the DSToken-compliant `SecuritizeOffRamp` (with country validation
and full DSToken compliance) with `ExternalLiquidityProvider`, which swaps the redeemed
asset for the liquidity token through Grove Basin (PSM3) at a strict 1:1 peg.

**Two-step transfer requirement — mandatory:** `ExternalLiquidityProvider.recipient()`
resolves to itself so the off-ramp must first deliver the asset to the provider before the
Grove Basin swap can execute. This requires the off-ramp to run in **two-step mode**. The
deploy task automatically enables this flag (`toggleTwoStepTransfer(true)`) immediately
after deploying `SecuritizeOffRamp`. Any manual deployment of this combination **must**
call `toggleTwoStepTransfer(true)` before the first redemption; omitting it causes the
single-step flow to bypass the provider entirely and the swap never executes.

**Grove Basin token wiring:** the `--liquidity-token` argument must match the Grove Basin
contract's `collateralToken` (the stablecoin delivered on redemption), and the `--asset`
argument must match Grove Basin's `creditToken` (the RWA swapped in). Do **not** match
against `swapToken`; that token is unrelated to this integration's redemption path.
The deploy task also forces `assetBurn = false` because the asset must be transferred to
`ExternalLiquidityProvider` before the Grove Basin swap.

```sh
npx hardhat deploy-redemption-external-liquidity-provider-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --liquidity-token {liquidityToken} --grove-basin {groveBasinContract}
```

### EIP-712 Signing Helpers

- Public Stock On Ramp swap

```sh
npx hardhat sign-public-stock-on-ramp --network arbitrum --contract {onRampAddress} --liquidityamount {liquidity} --minoutamount {minOut} [--private-key {hexPrivateKey}]
```

- Public Stock Off Ramp redeem

```sh
npx hardhat sign-public-stock-off-ramp --network arbitrum --contract {offRampAddress} --assetamount {assetAmount} --minoutputamount {minOutput} [--private-key {hexPrivateKey}]
```

### Test

```sh
npm test
```
