import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta } from '../../utils';

/*
npx hardhat deploy-redemption-allowance-protocol \
    --network sepolia \
    --asset 0xE4d65c4657685B746C8C73da51172bE24F4601F2 \
    --nav-provider 0x8eafa966CC7d899ed76bA2194411f3181b91a063 \
    --fee-manager 0xF9D80538B0d0ceD4515f2B41910b3690d98F4E2A \
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
        console.log('');
        consoleCyan('task: deploy-redemption-allowance-protocol');

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
            providerWallet: args.providerWallet,
        });

        // Get contract instances
        const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'AllowanceLiquidityProvider',
            liquidityProviderAddress,
        );

        console.log('Successfully set liquidity provider wallet');

        console.log('');
        console.log('Updating liquidity provider on securitize redemption contract');
        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);
        console.log('Successfully updated liquidity provider on securitize redemption contract');

        consoleGreen('Securitize Redemption Protocol has been configured successfully');

        console.log('');
        consoleGreen('Securitize Redemption Protocol has been deployed successfully');
        consoleMagenta(`- Redemption Address: ${redemptionAddress}`);
        consoleMagenta(`- Liquidity Provider Address: ${liquidityProviderAddress}`);

        return { redemption, liquidityProvider };
    });

// Deploy SecuritizeOffRamp proxy
// npx hardhat deploy-offramp --network sepolia --asset 0x123 --nav-provider 0xe76B92272667363FD487a71c13b7799ED924C9b8 --fee-manager 0xe76B92272667363FD487a71c13b7799ED924C9b8 --asset-burn false --verify
task('deploy-offramp', 'Deploy SecuritizeOffRamp proxy')
    .addParam('asset', 'DS Token to be redeemed')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')
    .addParam('assetBurn', 'Whether assets should be burned on redemption')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        console.log('');
        consoleCyan('task: deploy-offramp');
        consoleCyan('Arguments:');
        console.log(`- Asset: ${taskArgs.asset}`);
        console.log(`- NAV Provider: ${taskArgs.navProvider}`);
        console.log(`- Fee Manager: ${taskArgs.feeManager}`);
        console.log(`- Asset Burn: ${taskArgs.assetBurn}`);
        console.log(`- Verify: ${taskArgs.verify}`);

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
    .addOptionalParam('providerWallet', 'Wallet that provides liquidity')
    .setAction(async (taskArgs, hre) => {
        console.log('');
        consoleCyan('task: deploy-allowance-provider');
        consoleCyan('Arguments:');
        console.log(`- Liquidity Token: ${taskArgs.liquidityToken}`);
        console.log(`- Recipient: ${taskArgs.recipient}`);
        console.log(`- Redemption Address: ${taskArgs.redemptionAddress}`);
        console.log(`- Provider Wallet: ${taskArgs.providerWallet}`);
        console.log(`- Verify: ${taskArgs.verify}`);

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'AllowanceLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidityToken, taskArgs.recipient, taskArgs.redemptionAddress, taskArgs.providerWallet],
            verify: taskArgs.verify,
        });

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });
