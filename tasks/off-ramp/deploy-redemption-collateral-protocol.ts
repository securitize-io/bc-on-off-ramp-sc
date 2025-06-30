import { task } from 'hardhat/config';
import { consoleGreen, consoleYellow } from '../../utils';

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
    .addParam('redemption', 'External Collateral Redemption SC', undefined, types.string, false)

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (args, hre) => {
        console.log('');
        consoleGreen('Deploying Securitize Redemption Protocol (Collateral implementation)...');

        const { redemptionAddress } = await hre.run('deploy-offramp', {
            asset: args.asset,
            navProvider: args.navProvider,
            feeManager: args.feeManager,
            assetBurn: args.assetBurn,
            verify: args.verify,
        });

        const { liquidityProviderAddress } = await hre.run('deploy-collateral-provider', {
            liquidity: args.liquidityToken,
            recipient: args.recipient,
            securitizeOffRamp: redemptionAddress,
            verify: args.verify,
        });

        // // Get contract instances
        const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'CollateralLiquidityProvider',
            liquidityProviderAddress,
        );

        // console.log('');
        consoleGreen('Securitize Redemption Protocol has been deployed successfully');

        consoleYellow(
            'Proceeding to configure the protocol: setting external collateral redemption, collateral provider, and linking liquidity provider to the redemption contract...',
        );

        // Set external collateral redemption
        await liquidityProvider.setExternalCollateralRedemption(args.redemption);

        // Set collateral provider
        await liquidityProvider.setCollateralProvider(args.providerWallet);

        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);

        consoleGreen('Securitize Redemption Protocol has been configured successfully');

        return { redemption, liquidityProvider };
    });

// Deploy CollateralLiquidityProvider proxy
// npx hardhat deploy-collateral-provider --liquidity 0x123 --recipient 0x123 --redemption-address 0x123 --verify
task('deploy-collateral-provider', 'Deploy CollateralLiquidityProvider proxy')
    .addParam('liquidity', 'Stable coin to provide liquidity')
    .addParam('recipient', 'Wallet that receives DS Token')
    .addParam('securitizeOffRamp', 'SecuritizeOffRamp proxy address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        console.log('');
        consoleGreen('Deploying CollateralLiquidityProvider proxy...');
        consoleYellow('Arguments:');
        console.log(`- Liquidity Token: ${taskArgs.liquidity}`);
        console.log(`- Recipient: ${taskArgs.recipient}`);
        console.log(`- Securitize OffRamp: ${taskArgs.securitizeOffRamp}`);

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'CollateralLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidity, taskArgs.recipient, taskArgs.securitizeOffRamp],
            verify: taskArgs.verify,
        });

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });
