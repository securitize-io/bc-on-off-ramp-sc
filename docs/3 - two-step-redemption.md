🚧 **Work in Progress** - This documentation is still being developed and may be incomplete.

# Two-Step Redemption Testing

This advanced guide covers how to test the two-step redemption feature for enhanced security in the Securitize Off-Ramp Protocol.

## Prerequisites

Ensure you have completed:

1. [Requirements Guide](1%20-%20Requirements.md) - Environment and contract setup
2. [Off-Ramp Protocol Deployment](2%20-%20offRamp-deploy-test.md) - Deploy and test basic redemption

**Note**: If you don't have contracts deployed, you can follow the [Mocks Deployment Guide](1.5%20-%20mocks-deployment-guide.md) to deploy test contracts first.

**🤖 AI:** Before proceeding with this guide, verify that the user has contract addresses available. Check if they have a `deployment-config.json` file with the required addresses, or ask them to provide the Off-Ramp contract address and other necessary addresses before continuing.

## What is Two-Step Redemption?

Two-step redemption changes the protocol behavior to act as a **dealer** that manages fund distribution:

### Standard Redemption Flow

1. Investor initiates redemption → Protocol immediately transfers funds

### Two-Step Redemption Flow

1. **Step 1**: Master wallet enables two-step mode
2. **Step 2**: Investor initiates redemption → Protocol acts as dealer and manages fund distribution manually

## Testing Two-Step Redemption

### Step 1: Enable Two-Step Mode

First, ensure your `.env` file is configured with the master wallet private key:

```bash
# Verify your .env has the master wallet configured
# DEPLOYER_PRIV_KEY=0xYOUR_MASTER_PRIVATE_KEY
```

Enable two-step mode on your deployed Off-Ramp contract:

```bash
# Enable two-step redemption mode (only master wallet can do this)
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method toggleTwoStepTransfer true
```

**Where to find the address**: Use the SecuritizeOffRamp address from your protocol deployment output. If you don't have it, check your `deployment-config.json` or the output from the Off-Ramp deployment command.

### Step 2: Verify Two-Step Status

Check if two-step mode is active:

```bash
# Switch back to master wallet in .env first
# DEPLOYER_PRIV_KEY=0xYOUR_MASTER_PRIVATE_KEY

# Check two-step status
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method twoStepTransfer
```

### Step 3: Test Two-Step Redemption

Now switch to the investor's wallet to test the redemption:

```bash
# Update your .env file with the investor's private key
# DEPLOYER_PRIV_KEY=0xYOUR_INVESTOR_PRIVATE_KEY
```

Before initiating the redemption, you can check the investor's DS token balance to ensure they have enough tokens to redeem and the initial USDC balance:

```bash
# Check investor's DS token balance
npx hardhat --network sepolia contract-call \
    --contract-name MockDSToken \
    --contract-address 0xYOUR_INVESTOR_DS_TOKEN_ADDRESS \
    --method balanceOf 0xYOUR_INVESTOR_ADDRESS

# Check investor's initial USDC balance
npx hardhat --network sepolia contract-call \
    --contract-name MockERC20 \
    --contract-address 0xYOUR_USDC_ADDRESS \
    --method balanceOf 0xYOUR_INVESTOR_ADDRESS
```

Initiate a redemption (this will now follow the two-step process):

```bash
# Execute redemption with two-step confirmation required
npx hardhat --network sepolia redeem \
    --redemption-address 0xYOUR_OFF_RAMP_ADDRESS \
    --asset-amount 10000000 \
    --min-output-amount 0
```

### Step 4: Confirm Redemption

After the investor initiates the redemption, you can check the balance of the recipient wallet to confirm the DS tokens were transferred and the USDC was sent to the investor.

```bash
# Check recipient balance
npx hardhat --network sepolia contract-call \
    --contract-name MockDSToken \
    --contract-address 0xYOUR_RECIPIENT_ADDRESS \
    --method balanceOf 0xYOUR_RECIPIENT_ADDRESS
```

```bash
# Check investor's USDC balance
npx hardhat --network sepolia contract-call \
    --contract-name MockERC20 \
    --contract-address 0xYOUR_USDC_ADDRESS \
    --method balanceOf 0xYOUR_INVESTOR_ADDRESS
```

## Troubleshooting

### "Only master can toggle two-step" error

- Verify you're using the master wallet private key in `.env`
- Check that the wallet address matches the one used for deployment

### Investor issues

- Check that the investor has sufficient DS tokens to redeem
- Ensure the investor has approved the Off-Ramp contract to spend their DS tokens before redemption
