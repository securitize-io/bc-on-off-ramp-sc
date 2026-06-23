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

##### Third Party Contract Off Ramp Integration

The third party off-ramp redeems a Securitize RWA asset (DSToken) for a liquidity token by
routing an atomic swap through the external Grove Basin (PSM3) protocol. It validates the
delivered amount against a NAV-derived tolerance band and requires the protocol-owned
addresses (OffRamp, LiquidityProvider, FeeCollector and the Grove Basin `pocket()`) to be
registered as platform wallets in the DSToken.

See the full technical reference in [ThirdPartyOffRamp.md](./ThirdPartyOffRamp.md).

```sh
npx hardhat deploy-third-party-protocol --network sepolia --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --liquidity-token {liquidityToken} --grove-basin {groveBasinContract} [--redeem-tolerance {0..100000}]
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
