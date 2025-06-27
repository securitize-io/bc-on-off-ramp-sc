import { task, types } from 'hardhat/config';

// npx hardhat deploy-redemption-allowance-protocol --network sepolia --recipient 0xe76B92272667363FD487a71c13b7799ED924C9b8 --liquidity 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 --asset 0x779877a7b0d9e8603169ddbd7836e478b4624789 --provider 0x123 --nav 0x123 --feeManager 0x123 --assetBurn false --verify
task('deploy-redemption-allowance-protocol', 'Deploy Redemption Protocol (Allowance implementation)')
    // SecuritizeOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed', undefined, types.string, false)
    .addParam('navProvider', 'NAV rate provider address', undefined, types.string, false)
    .addParam('feeManager', 'Fee manager address', undefined, types.string, false)
    .addParam('assetBurn', 'Whether assets should be burned on redemption', false, types.boolean, true)

    // AllowanceLiquidityProvider arguments
    .addParam('recipient', 'Wallet that receives DS Token', undefined, types.string, false)
    .addParam('liquidity', 'Stable coin to provide liquidity', undefined, types.string, false)
    .addParam('provider', 'Wallet that provides liquidity', undefined, types.string, false)

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (args, hre) => {
        const Redemption = await hre.ethers.getContractFactory('SecuritizeOffRamp');
        const redemption = await hre.upgrades.deployProxy(Redemption, [
            args.asset,
            args.navProvider,
            args.feeManager,
            args.assetBurn,
        ]);
        await redemption.waitForDeployment();

        const redemptionAddress = await redemption.getAddress();
        console.log(`Securitize Redemption Proxy address: ${redemptionAddress}`);

        const redemptionImpl = await hre.upgrades.erc1967.getImplementationAddress(redemptionAddress);
        console.log(`Securitize Redemption Implementation address: ${redemptionImpl}`);

        ///////////////

        const LiquidityProvider = await hre.ethers.getContractFactory('AllowanceLiquidityProvider');
        const liquidityProvider = await hre.upgrades.deployProxy(
            LiquidityProvider,
            [args.liquidity, args.recipient, redemptionAddress],
            {
                kind: 'uups',
            },
        );
        await liquidityProvider.waitForDeployment();

        const liquidityProviderAddress = await liquidityProvider.getAddress();
        console.log(`Liquidity Provider Proxy address: ${liquidityProviderAddress}`);

        const liquidityProviderImpl = await hre.upgrades.erc1967.getImplementationAddress(liquidityProviderAddress);
        console.log(`Liquidity Provider Implementation address: ${liquidityProviderImpl}`);

        // Set liquidity provider wallet
        await liquidityProvider.setAllowanceProviderWallet(args.provider);

        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);

        if (args.verify) {
            console.log('Verifying contracts on Etherscan...');
            await hre.run('verify:verify', {
                address: redemptionAddress,
                constructorArguments: [args.token, args.nav, args.feeManager, args.assetBurn],
            });

            await hre.run('verify:verify', {
                address: liquidityProviderAddress,
                constructorArguments: [args.liquidity, args.recipient, redemptionAddress],
            });
            console.log('Contracts verified successfully.');
        }

        return { redemption, liquidityProvider };
    });
