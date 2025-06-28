import { task } from 'hardhat/config';

// Deploy SecuritizeOffRamp proxy
// npx hardhat deploy-offramp --network sepolia --asset 0x123 --nav-provider 0xe76B92272667363FD487a71c13b7799ED924C9b8 --fee-manager 0xe76B92272667363FD487a71c13b7799ED924C9b8 --asset-burn false --verify
task('deploy-offramp', 'Deploy SecuritizeOffRamp proxy')
    .addParam('asset', 'DS Token to be redeemed')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')
    .addParam('assetBurn', 'Whether assets should be burned on redemption')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        console.log('Deploying SecuritizeOffRamp proxy...');
        console.log('Arguments:');
        console.log(`- Asset: ${taskArgs.asset}`);
        console.log(`- NAV Provider: ${taskArgs.navProvider}`);
        console.log(`- Fee Manager: ${taskArgs.feeManager}`);
        console.log(`- Asset Burn: ${taskArgs.assetBurn}`);

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'SecuritizeOffRamp',
            kind: 'uups',
            args: [taskArgs.asset, taskArgs.navProvider, taskArgs.feeManager, taskArgs.assetBurn],
            verify: taskArgs.verify,
        });

        return { redemptionAddress: proxyAddress, redemptionImpl: implAddress };
    });

// Deploy AllowanceLiquidityProvider proxy
// npx hardhat deploy-allowance-provider --liquidityToken 0x123 --recipient 0x123 --redemptionAddress 0x123
task('deploy-allowance-provider', 'Deploy AllowanceLiquidityProvider proxy')
    .addParam('liquidityToken', 'Stable coin to provide liquidity')
    .addParam('recipient', 'Wallet that receives DS Token')
    .addParam('redemptionAddress', 'SecuritizeOffRamp proxy address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        console.log('Deploying AllowanceLiquidityProvider proxy...');
        console.log('Arguments:');
        console.log(`- Liquidity Token: ${taskArgs.liquidityToken}`);
        console.log(`- Recipient: ${taskArgs.recipient}`);
        console.log(`- Redemption Address: ${taskArgs.redemptionAddress}`);

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'AllowanceLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidityToken, taskArgs.recipient, taskArgs.redemptionAddress],
            verify: taskArgs.verify,
        });
        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });

/*
npx hardhat deploy-redemption-allowance-protocol \
    --network sepolia \
    --asset  \
    --nav-provider 0x8eafa966CC7d899ed76bA2194411f3181b91a063 \
    --fee-manager 0x690112eB8C59F2bF3857153cC9b484faF0C7817A \
    --asset-burn false \
    --recipient 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
    --provider-wallet 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --verify
*/
task('deploy-redemption-allowance-protocol', 'Deploy Redemption Protocol (Allowance implementation)')
    // SecuritizeOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')
    .addParam('assetBurn', 'Whether assets should be burned on redemption')

    // AllowanceLiquidityProvider arguments
    .addParam('recipient', 'Wallet that receives DS Token')
    .addParam('liquidityToken', 'Stable coin to provide liquidity')
    .addParam('providerWallet', 'Wallet that provides liquidity')

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (args, hre) => {
        const { redemptionAddress } = await hre.run('deploy-offramp', {
            asset: args.asset,
            navProvider: args.navProvider,
            feeManager: args.feeManager,
            assetBurn: args.assetBurn,
            verify: args.verify,
        });

        const { liquidityProviderAddress } = await hre.run('deploy-allowance-provider', {
            liquidityToken: args.liquidityToken,
            recipient: args.recipient,
            redemptionAddress,
            verify: args.verify,
        });

        // Get contract instances
        const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'AllowanceLiquidityProvider',
            liquidityProviderAddress,
        );

        console.log('Securitize Redemption Protocol has been deployed successfully');

        console.log(
            'Proceeding to configure the protocol: setting allowance provider wallet and linking liquidity provider to the redemption contract...',
        );

        // Set liquidity provider wallet
        await liquidityProvider.setAllowanceProviderWallet(args.providerWallet);

        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);

        console.log('Securitize Redemption Protocol has been configured successfully');

        return { redemption, liquidityProvider };
    });
