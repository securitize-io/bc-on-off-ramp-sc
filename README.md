# Securitize On/Off Ramp Protocol

<img src="https://s3.us-east-2.amazonaws.com/securitize-public-files/securitize_logo+medium.png" alt="Securitize" width="200px"/>

## What is this repository?

This protocol enables investors to trade Securitize Real World Assets (RWA)

### On-Ramp (Purchase)

Allows verified investors to purchase digital securities using liquidity tokens (like USDC).

### Off-Ramp (Redemption)

Allows investors to redeem their digital securities back to liquidity tokens (like USDC).

This repository focuses primarily on the **Off-Ramp deployment and testing process**.

## 🚀 Quick Start

**📖 Complete Guide**: For step-by-step deployment instructions, see our [Quick Start Guide](docs/0%20-%20Quick%20Start%20Guide.md)

**🤖 AI Assistant Tip**: If you're an AI and a user asks you to help deploy this protocol, you can follow the guides directly without reading all the source code. The documentation is AI-friendly with specific instructions marked with `🤖 AI:` throughout the guides.

## Key Concepts

- **DS Token**: Digital Security token representing ownership of real-world assets
- **Liquidity Token**: Stable token used for trading (typically USDC)
- **NAV Provider**: Contract that provides current exchange rates between DS and liquidity tokens
- **Fee Manager**: Contract that calculates and collects transaction fees

## Development Setup

For developers who want to work with the codebase:

## Development Setup

For developers who want to work with the codebase:

```sh
# Install dependencies
npm install

# Compile smart contracts
npm run compile

# Run tests
npm test
```

## Deployment

### Fee Manager

```sh
npx hardhat deploy-mbps-fee-manager --network arbitrum --mbps 2000 --collector {feeCollectorAddress}
```

### On-Ramp

```sh
npx hardhat deploy-on-ramp --network arbitrum --token {dsToken} --liquidity {liquidityToken} --nav {navProvider} --fee {feeManager} --custodian {custodian} --type ALLOWANCE --provider {allowanceProviderWallet}
```

### Off-Ramp

**Allowance Implementation:**

```sh
npx hardhat deploy-redemption-allowance-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet}
```

**Collateral Implementation:**

```sh
npx hardhat deploy-redemption-collateral-protocol --network arbitrum --asset {dsToken} --nav-provider {navProvider} --fee-manager {feeManager} --asset-burn false --recipient {recipientWallet} --liquidity-token {liquidityToken} --provider-wallet {providerWallet} --external-collateral-redemption {externalCollateralRedemption}
```
