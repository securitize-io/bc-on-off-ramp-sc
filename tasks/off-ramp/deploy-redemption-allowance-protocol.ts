import { task, types } from 'hardhat/config';

task('deploy-redemption-allowance-protocol', 'Deploy Redemption Protocol (Allowance implementation)')
    .addParam('recipient', 'Wallet that receives DS Token', undefined, types.string, false)
    .addParam('liquidity', 'Stable coin to provide liquidity', undefined, types.string, false)
    .addParam('provider', 'Wallet that provides liquidity', undefined, types.string, false)
    .addParam('token', 'DS Token to be redeemed', undefined, types.string, false)
    .addParam('nav', 'NAV rate provider address', undefined, types.string, false)
    .addParam('feeManager', 'Fee manager address', undefined, types.string, false)
    .addParam('assetBurn', 'Whether assets should be burned on redemption', false, types.boolean, true)
    .setAction(async (args, hre) => {
        const Redemption = await hre.ethers.getContractFactory('SecuritizeOffRamp');
        const redemption = await hre.upgrades.deployProxy(Redemption, [
            args.token,
            args.nav,
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

        return { redemption, liquidityProvider };
    });
