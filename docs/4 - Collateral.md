### 4. Collateral Flow: Deployment & Setup

#### 4.1 Deploy the New DS Token

```bash
npx hardhat --network sepolia deploy-contract \
  --contract-name MockDSToken \
  "Second DS Token" "SDST" 8 \
  $REGISTRY_SERVICE_ADDRESS $TRUST_SERVICE_ADDRESS
```

#### 4.2 Mint Tokens

# Mint the original DS token to the provider wallet
```bash
npx hardhat --network sepolia contract-call \
  --contract-name MockDSToken \
  --contract-address 0xYOUR_ORIGINAL_DS_TOKEN_ADDRESS \
  --method mint 0xYOUR_PROVIDER_ADDRESS "1000000000000000000"
```

# Mint the new DS token to the investor wallet
```bash
npx hardhat --network sepolia contract-call \
  --contract-name MockDSToken \
  --contract-address 0xYOUR_NEW_DS_TOKEN_ADDRESS \
  --method mint 0xYOUR_INVESTOR_ADDRESS "100000000000000000"
```

#### 4.3 Deploy Collateral Contracts

```bash
npx hardhat deploy-redemption-collateral-protocol \
  --network sepolia \
  --asset 0xYOUR_NEW_DS_TOKEN_ADDRESS \
  --nav-provider 0xYOUR_NAV_PROVIDER_ADDRESS \
  --fee-manager 0xYOUR_FEE_MANAGER_ADDRESS \
  --asset-burn false \
  --recipient 0xYOUR_RECIPIENT_ADDRESS \
  --liquidity-token 0xYOUR_USDC_ADDRESS \
  --provider-wallet 0xYOUR_PROVIDER_ADDRESS \
  --external-collateral-redemption 0xYOUR_OFF_RAMP_ALLOWANCE_ADDRESS \
  --verify --verbose-logs
```

#### 4.4 Register the Liquidity Provider

```bash
npx hardhat --network sepolia register-investor \
  --registry-address 0xYOUR_REGISTRY_SERVICE_ADDRESS \
  --investor-address 0xYOUR_LIQUIDITY_PROVIDER_ADDRESS \
  --investor-id "liquidity_provider" \
  --country "AR"
```

#### 4.5 Approvals

# Approve the provider wallet to allow the liquidity provider to use the original DS token
```bash
npx hardhat approve \
  --network sepolia \
  --token 0xYOUR_ORIGINAL_DS_TOKEN_ADDRESS \
  --owner 0xYOUR_PROVIDER_ADDRESS \
  --spender 0xYOUR_LIQUIDITY_PROVIDER_ADDRESS \
  --private-key 0xYOUR_PRIVATE_KEY
```

# Approve the investor wallet to allow the redemption contract to use the new DS token
```bash
npx hardhat approve \
  --network sepolia \
  --token 0xYOUR_NEW_DS_TOKEN_ADDRESS \
  --owner 0xYOUR_INVESTOR_ADDRESS \
  --spender 0xYOUR_REDEMPTION_CONTRACT_ADDRESS \
  --amount 2000000000 \
  --private-key 0xYOUR_PRIVATE_KEY
```

#### 4.6 Redeem

```bash
npx hardhat redeem \
  --network sepolia \
  --redemption-address 0xYOUR_REDEMPTION_CONTRACT_ADDRESS \
  --asset-amount 1000000000 \
  --min-output-amount 0
```
