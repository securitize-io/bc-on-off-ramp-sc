# Requirements and Environment Setup

This guide covers the prerequisites and environment setup needed before deploying the Securitize Off-Ramp Protocol.

## Environment Setup

First, you need to create and configure your environment file:

## Install Dependencies

```bash
npm install
```

## Create .env File

Copy the example environment file and edit it with your specific configuration:

```bash
cp .env.example .env
```

**🤖 AI:** Verify that the `.env` file exists and contains `DEPLOYER_PRIV_KEY` and the RPC URL for the target network. If missing, guide the user to create it using the example above.

# Required Contracts and Services

Before deploying the Off-Ramp system, you need these contracts deployed. Here's what each one does:

## Core System Contracts

- **NAV Provider** - Provides real-time exchange rates between DS tokens and liquidity tokens (like USDC)
- **Fee Manager** - Calculates and handles transaction fees for redemptions
- **Registry Service** - Validates that investors are authorized to perform transactions
- **Trust Service** - Manages trust relationships and token permissions (if needed)

## Token Contracts

- **DS Token** - The Digital Security token that investors want to redeem (what they're selling)
- **Liquidity Token** - The token investors receive in exchange (typically USDC - what they're buying)

⚠️ **Don't have contracts deployed?** Follow the [Mocks Deployment Guide](1.5%20-%20mocks-deployment-guide.md) to deploy test contracts.

# Required Wallets and Their Roles

The system requires different wallet addresses for different roles in the redemption process:

## Wallet Roles Explained

- **Master Wallet** - The wallet that deploys contracts and manages the system (configured in `.env` as `DEPLOYER_PRIV_KEY`)
- **Provider Wallet** - Holds the liquidity tokens (USDC) that will be given to investors during redemptions
- **Recipient Wallet** - Receives the DS tokens after redemptions are processed
- **Fee Collector** - Receives the in liquidity tokens fees collected from each redemption transaction
- **Investor Wallet** - The wallet that holds DS tokens and wants to redeem them for liquidity tokens

## How These Wallets Work Together

1. **Master Wallet** manages the overall system, deploys contracts, and configures the Off-Ramp protocol
2. **Investor** wants to redeem 100 DS tokens
3. **Provider Wallet** supplies USDC (minus fees) to the investor (e.g., 98 USDC)
4. **Fee Collector** receives the transaction fee (e.g., 2 USDC)
5. **Recipient Wallet** receives the redeemed DS tokens

⚠️ **Don't have wallets setup?** The [Mocks Deployment Guide](1.5%20-%20mocks-deployment-guide.md) includes wallet creation instructions.

These contract and wallets addresses must be configured in `deployment-config.json`. You can use `deployment-config-example.json` as a reference.

**Note:** The `deployment-config.json` file is optional and provided for user organization only. All deployment scripts accept parameters directly via command line arguments.

**🤖 AI:** If the user hasn't configured the deployment-config.json file, offer to help them by deploying mock contracts and creating new wallets for testing purposes.

## Next Steps

Now that you understand the requirements, you have two options:

### Option 1: Use Test/Mock Contracts (Recommended for Testing)

If you don't have real contracts deployed yet, proceed to the [Mock Contracts Deployment Guide](1.5%20-%20mocks-deployment-guide.md) to:

- Create test wallets with funding
- Deploy mock contracts for testing
- Mint test tokens

### Option 2: Use Real Contracts (Production)

If you already have real contracts deployed, proceed directly to the [Off-Ramp Protocol Deployment](2%20-%20offRamp-deploy-test.md) with your actual contract addresses and wallet configurations.

**🤖 AI:** Ask the user if they want to deploy mock contracts for testing or if they already have real contracts to use. Guide them to the appropriate next step.
