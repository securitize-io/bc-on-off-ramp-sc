import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta, consoleYellow } from '../../utils';

/*
npx hardhat deploy-public-stock-offramp-collateral-protocol \
    --network sepolia \
    --asset 0xd1c009BF8402b24c77F29Ef8Bc99C099c90478De \
    --nav-provider 0x8f98297E6A2250647D731c99E23c76Ce0C3BffD7 \
    --fee-manager 0xF9D80538B0d0ceD4515f2B41910b3690d98F4E2A \
    --asset-burn false \
    --recipient 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
    --provider-wallet 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --external-collateral-redemption 0x8C30865F25f1f46fA36Dfe4cC39e663E751724D9 \
    --verify
*/
task('deploy-public-stock-offramp-collateral-protocol', 'Deploy Public Stock Off-Ramp Protocol (Collateral implementation)')
    // PublicStockOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')
    .addParam('assetBurn', 'Whether assets should be burned on redemption')

    // CollateralLiquidityProvider arguments
    .addParam('liquidityToken', 'Stable coin to provide liquidity')
    .addParam('recipient', 'Wallet that receives DS Token (SCOPE)')
    .addParam('providerWallet', 'Wallet that provides collateral (BUIDL)')
    .addParam('externalCollateralRedemption', 'External Collateral Redemption SC')

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Verbose output')

    .setAction(async (args, hre) => {
        if (!args.silenceLogs) {
            consoleCyan('\n task: deploy-public-stock-offramp-collateral-protocol');
            consoleCyan('Arguments:');
            console.log(`- Asset: ${args.asset}`);
            console.log(`- NAV Provider: ${args.navProvider}`);
            console.log(`- Fee Manager: ${args.feeManager}`);
            console.log(`- Asset Burn: ${args.assetBurn}`);
            console.log(`- Liquidity Token: ${args.liquidityToken}`);
            console.log(`- Recipient: ${args.recipient}`);
            console.log(`- Provider Wallet: ${args.providerWallet}`);
            console.log(`- External Collateral Redemption: ${args.externalCollateralRedemption}`);
            console.log(`- Verify: ${args.verify}`);
        }

        const { redemptionAddress } = await hre.run('deploy-public-stock-offramp', {
            asset: args.asset,
            navProvider: args.navProvider,
            feeManager: args.feeManager,
            assetBurn: args.assetBurn,
            verify: args.verify,
            silenceLogs: args.silenceLogs,
        });

        const collateralContract = await hre.ethers.getContractAt('ISecuritizeOffRamp', args.externalCollateralRedemption);

        const { liquidityProviderAddress } = await hre.run('deploy-collateral-provider', {
            liquidity: args.liquidityToken,
            recipient: args.recipient,
            securitizeOffRamp: redemptionAddress,
            collateralToken: await collateralContract.asset(),
            externalCollateralRedemption: args.externalCollateralRedemption,
            collateralProvider: args.providerWallet,
            silenceLogs: args.silenceLogs,
            verify: args.verify,
        });

        // // Get contract instances
        const redemption = await hre.ethers.getContractAt('PublicStockOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'CollateralLiquidityProvider',
            liquidityProviderAddress,
        );

        if (!args.silenceLogs) {
            consoleYellow(
                'Proceeding to configure the protocol: setting external collateral redemption, collateral provider, and linking liquidity provider to the redemption contract...',
            );

            console.log('Updating liquidity provider on public stock redemption contract');
        }
        // Set liquidity provider on public stock redemption contract
        let tx = await redemption.updateLiquidityProvider(liquidityProviderAddress);
        await tx.wait(1);

        if (!args.silenceLogs) {
            consoleGreen('Public Stock Redemption Protocol has been configured successfully');

            consoleGreen('\n Public Stock Redemption Protocol has been deployed successfully');
            consoleMagenta(`- Redemption Address: ${redemptionAddress}`);
            consoleMagenta(`- Liquidity Provider Address: ${liquidityProviderAddress}`);
        }

        return { redemption, liquidityProvider };
    });
