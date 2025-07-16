import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta, consoleYellow } from '../../utils';

/*
npx hardhat deploy-redemption-collateral-protocol \
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
task('deploy-redemption-collateral-protocol', 'Deploy Redemption Protocol (Collateral implementation)')
    // SecuritizeOffRamp arguments
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
    .addFlag('verboseLogs', 'Verbose output')

    .setAction(async (args, hre) => {
        if (args.verboseLogs) {
            console.log('');
            consoleCyan('task: deploy-redemption-collateral-protocol');
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

        const { redemptionAddress } = await hre.run('deploy-offramp', {
            asset: args.asset,
            navProvider: args.navProvider,
            feeManager: args.feeManager,
            assetBurn: args.assetBurn,
            verify: args.verify,
        });

        const collateralContract = await hre.ethers.getContractAt(
            'ISecuritizeOffRamp',
            args.externalCollateralRedemption,
        );

        const { liquidityProviderAddress } = await hre.run('deploy-collateral-provider', {
            liquidity: args.liquidityToken,
            recipient: args.recipient,
            securitizeOffRamp: redemptionAddress,
            collateralToken: await collateralContract.asset(),
            externalCollateralRedemption: args.externalCollateralRedemption,
            collateralProvider: args.providerWallet,
            verify: args.verify,
        });

        // // Get contract instances
        const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'CollateralLiquidityProvider',
            liquidityProviderAddress,
        );

        if (args.verboseLogs) {
            consoleYellow(
                'Proceeding to configure the protocol: setting external collateral redemption, collateral provider, and linking liquidity provider to the redemption contract...',
            );

            console.log('Updating liquidity provider on securitize redemption contract');
        }
        // Set liquidity provider on securitize redemption contract
        let tx = await redemption.updateLiquidityProvider(liquidityProviderAddress);
        await tx.wait(1);

        if (args.verboseLogs) {
            consoleGreen('Securitize Redemption Protocol has been configured successfully');

            console.log('');
            consoleGreen('Securitize Redemption Protocol has been deployed successfully');
            consoleMagenta(`- Redemption Address: ${redemptionAddress}`);
            consoleMagenta(`- Liquidity Provider Address: ${liquidityProviderAddress}`);
        }

        return { redemption, liquidityProvider };
    });

// Deploy CollateralLiquidityProvider proxy
// npx hardhat deploy-collateral-provider --liquidity 0x123 --recipient 0x123 --redemption-address 0x123 --verify
task('deploy-collateral-provider', 'Deploy CollateralLiquidityProvider proxy')
    .addParam('liquidity', 'Stable coin to provide liquidity')
    .addParam('recipient', 'Wallet that receives DS Token')
    .addParam('securitizeOffRamp', 'SecuritizeOffRamp proxy address')
    .addParam('externalCollateralRedemption', 'External Collateral Redemption SC')
    .addParam('collateralProvider', 'Collateral Provider address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('verboseLogs', 'Verbose output')
    .setAction(async (taskArgs, hre) => {
        if (taskArgs.verboseLogs) {
            console.log('');
            consoleCyan('task: deploy-collateral-provider');
            consoleCyan('Arguments:');
            console.log(`- Liquidity Token: ${taskArgs.liquidity}`);
            console.log(`- Recipient: ${taskArgs.recipient}`);
            console.log(`- Securitize OffRamp: ${taskArgs.securitizeOffRamp}`);
        }
        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'CollateralLiquidityProvider',
            kind: 'uups',
            args: [
                taskArgs.liquidity,
                taskArgs.recipient,
                taskArgs.securitizeOffRamp,
                taskArgs.externalCollateralRedemption,
                taskArgs.collateralProvider,
            ],
            verify: taskArgs.verify,
        });

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });
