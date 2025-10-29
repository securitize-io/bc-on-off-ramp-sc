# Off-Ramp Protocol Deployment and Testing

This guide describes how to deploy the Securitize Off-Ramp system and test it with a redemption transaction.

## Prerequisites

Ensure you have completed:

1. [Requirements Guide](1%20-%20Requirements.md) - Environment and contract setup
2. [Mocks Deployment Guide](1.5%20-%20mocks-deployment-guide.md) - If using test contracts

## Deployment

### Deploy Off-Ramp System

You'll need the contract addresses from the previous guides and wallet addresses from `.env.wallets`. Replace each placeholder with your actual values:

```bash
npx hardhat --network sepolia deploy-redemption-allowance-protocol \
    --asset 0xYOUR_DS_TOKEN_ADDRESS \
    --nav-provider 0xYOUR_NAV_PROVIDER_ADDRESS \
    --fee-manager 0xYOUR_FEE_MANAGER_ADDRESS \
    --asset-burn false \
    --recipient 0xYOUR_RECIPIENT_ADDRESS \
    --liquidity-token 0xYOUR_USDC_ADDRESS \
    --provider-wallet 0xYOUR_PROVIDER_ADDRESS \
    --verify --verbose-logs
```

**Where to find these addresses:**

- `DS_TOKEN_ADDRESS` & `USDC_ADDRESS`: From mock contract deployment output
- `NAV_PROVIDER_ADDRESS` & `FEE_MANAGER_ADDRESS`: From mock contract deployment output
- `RECIPIENT_ADDRESS` & `PROVIDER_ADDRESS`: From `.env.wallets` file

After running the command, you will see output like:

```
SecuritizeOffRamp deployed to: 0x1234567890...
LiquidityProvider deployed to: 0xabcdef1234...
```

**Save these addresses** - you'll need them for verification and testing.

## Verification

Verify that your deployment was successful by checking the contract configuration:

```bash
# Check that the Off-Ramp contract has the correct DS token configured
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method asset

# Check that it has the correct liquidity provider
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method liquidityProvider

# Verify the NAV provider is configured
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method navProvider

# Verify the fee manager is configured
npx hardhat --network sepolia contract-call \
    --contract-name SecuritizeOffRamp \
    --contract-address 0xYOUR_OFF_RAMP_ADDRESS \
    --method feeManager
```

**Replace `0xYOUR_OFF_RAMP_ADDRESS`** with the actual SecuritizeOffRamp address from the deployment output.

### Verify Liquidity Provider Configuration

```bash
# Check that the liquidity provider has the correct USDC token
npx hardhat --network sepolia contract-call \
    --contract-name ILiquidityProvider \
    --contract-address 0xYOUR_LIQUIDITY_PROVIDER_ADDRESS \
    --method liquidityToken

# Check that it has the correct recipient wallet
npx hardhat --network sepolia contract-call \
    --contract-name ILiquidityProvider \
    --contract-address 0xYOUR_LIQUIDITY_PROVIDER_ADDRESS \
    --method recipient
```

**Replace `0xYOUR_LIQUIDITY_PROVIDER_ADDRESS`** with the actual LiquidityProvider address from the deployment output.

## Post-Deployment Setup

### 1. Configure Token Allowances

Before testing, you need to configure allowances so contracts can move tokens:

```bash
# Allow the liquidity provider to spend USDC from the provider wallet
npx hardhat --network sepolia approve \
    --token 0xYOUR_USDC_ADDRESS \
    --owner 0xYOUR_PROVIDER_ADDRESS \
    --spender 0xYOUR_LIQUIDITY_PROVIDER_ADDRESS \
    --private-key 0xYOUR_PROVIDER_PRIVATE_KEY
```

**Where to find these values:**

- `USDC_ADDRESS`: From mock USDC deployment
- `PROVIDER_ADDRESS` & `PROVIDER_PRIVATE_KEY`: From `.env.wallets`
- `LIQUIDITY_PROVIDER_ADDRESS`: From Off-Ramp deployment output

### 2. Test a Redemption

Now test the full redemption flow:

```bash
# Step 1: Approve DS tokens to the Off-Ramp contract (so it can take them from investor)
npx hardhat --network sepolia approve \
    --token 0xYOUR_DS_TOKEN_ADDRESS \
    --owner 0xYOUR_INVESTOR_ADDRESS \
    --spender 0xYOUR_OFF_RAMP_ADDRESS \
    --amount 1000000000 \
    --private-key 0xYOUR_INVESTOR_PRIVATE_KEY
```

### Step 3: Execute the redemption (investor trades DS tokens for USDC)

**⚠️ Important**: Before executing the redemption, you must change your `.env` file to use the investor's private key, as the redemption must be called from the investor's account:

**🤖 AI:** Check if the user has changed their `.env` file to use the investor's private key. The redemption transaction must be sent from the investor's account, not the deployer's account.

```bash
# Temporarily update your .env file with the investor's private key
DEPLOYER_PRIV_KEY=0xYOUR_INVESTOR_PRIVATE_KEY
```

Now execute the redemption:

```bash
npx hardhat --network sepolia redeem \
    --redemption-address 0xYOUR_OFF_RAMP_ADDRESS \
    --asset-amount 1000000000 \
    --min-output-amount 0
```

**Remember to change your `.env` back to the original deployer private key after testing!**

**🤖 AI:** Don't forget to switch your `.env` file back to the original deployer private key after completing the redemption test. This is important for future deployments and contract interactions.

**Where to find these values:**

- `DS_TOKEN_ADDRESS`: From mock DS token deployment
- `INVESTOR_ADDRESS` & `INVESTOR_PRIVATE_KEY`: From `.env.wallets`
- `OFF_RAMP_ADDRESS`: From Off-Ramp deployment output

If successful, you should see the investor receive USDC tokens!

## Next Steps

Your Off-Ramp system is now deployed and ready for use. Monitor redemption events and maintain adequate liquidity in the provider wallet.

## Common Issues & Troubleshooting

### "Execution reverted" error during redemption

- **Investor not registered**: You must register the investor with MockRegistryService before redemption works
- **Use updateInvestor**: Call `updateInvestor()` on the MockRegistryService contract with investor details
- **Alternative: addWallet**: You can also try `addWallet()` method to add the investor wallet address

Example registration:

```bash
npx hardhat register-investor --network sepolia \
    --registry-address 0xYOUR_REGISTRY_ADDRESS \
    --investor-address 0xYOUR_INVESTOR_ADDRESS
```

### "Wrong account" or redemption from wrong wallet

- **Change .env**: The redemption must be called from the investor's account, not the deployer
- **Update DEPLOYER_PRIV_KEY**: Temporarily change the private key in `.env` to the investor's private key
- **Remember to switch back**: After redemption, change `.env` back to the master wallet private key

### "Insufficient allowance" error

- Make sure you completed step 1 in Post-Deployment Setup
- Check that the allowance amount is sufficient for the redemption

### "Insufficient balance" error

- Ensure the provider wallet has enough USDC tokens
- Ensure the investor wallet has enough DS tokens
- Check that you minted tokens in the mocks deployment step

### Variables not found

- Double-check that you replaced all placeholder addresses (0xYOUR\_...)
- Verify addresses by checking `.env.wallets` and deployment outputs
- Make sure you're using the correct network (sepolia in examples)

**🤖 AI:** After successful deployment and testing, offer to help the user with:

- Setting up monitoring for the deployed contracts
- Configuring additional test scenarios
- Understanding the contract interactions and event logs
- Troubleshooting any deployment or testing issues
