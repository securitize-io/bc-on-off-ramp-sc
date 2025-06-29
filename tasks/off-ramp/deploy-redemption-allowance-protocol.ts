import { task } from 'hardhat/config';
import { consoleGreen, consoleRed, consoleYellow } from '../../utils';

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
        consoleGreen('Deploying SecuritizeOffRamp proxy...');
        consoleYellow('Arguments:');
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
    .addFlag('allowanceProviderWallet', 'Set allowance for the liquidity provider wallet')
    .addOptionalParam('providerWallet', 'Wallet that provides liquidity')
    .setAction(async (taskArgs, hre) => {
        console.log('');
        consoleGreen('Deploying AllowanceLiquidityProvider proxy...');
        consoleYellow('Arguments:');
        console.log(`- Liquidity Token: ${taskArgs.liquidityToken}`);
        console.log(`- Recipient: ${taskArgs.recipient}`);
        console.log(`- Redemption Address: ${taskArgs.redemptionAddress}`);

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'AllowanceLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidityToken, taskArgs.recipient, taskArgs.redemptionAddress],
            verify: taskArgs.verify,
        });

        if (taskArgs.allowanceProviderWallet) {
            // Set allowance for the liquidity provider
            await hre.run('set-liquidity-provider-allowance', {
                liquidityToken: taskArgs.liquidityToken,
                providerWallet: taskArgs.providerWallet,
                liquidityProviderAddress: proxyAddress,
            });
        }

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });

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
    --allowance-provider-wallet \
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
    .addFlag('allowanceProviderWallet', 'Set allowance for the liquidity provider wallet')
    .setAction(async (args, hre) => {
        console.log('');
        consoleGreen('Deploying Securitize Redemption Protocol (Allowance implementation)...');

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
            allowanceProviderWallet: args.allowanceProviderWallet,
            providerWallet: args.providerWallet,
        });

        // Get contract instances
        const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'AllowanceLiquidityProvider',
            liquidityProviderAddress,
        );

        consoleGreen('Securitize Redemption Protocol has been deployed successfully');

        consoleYellow(
            'Proceeding to configure the protocol: setting allowance provider wallet and linking liquidity provider to the redemption contract...',
        );

        // Set liquidity provider wallet
        await liquidityProvider.setAllowanceProviderWallet(args.providerWallet);

        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);

        consoleGreen('Securitize Redemption Protocol has been configured successfully');

        return { redemption, liquidityProvider };
    });

/*
npx hardhat set-liquidity-provider-allowance --network sepolia --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 --provider-wallet 0xe76B92272667363FD487a71c13b7799ED924C9b8 --liquidity-provider-address 0x66754A2080dA6bf936fEbE90d2eB5FdBea81f1E8
*/
task('set-liquidity-provider-allowance', 'Set allowance for the liquidity provider')
    .addParam('liquidityToken', 'Stable coin to provide liquidity')
    .addParam('providerWallet', 'Wallet that provides liquidity')
    .addParam('liquidityProviderAddress', 'Address of the liquidity provider')
    .setAction(async (args, hre) => {
        console.log('');
        consoleGreen('Setting allowance for the liquidity provider...');
        consoleYellow('Arguments:');
        console.log(`- Liquidity Token: ${args.liquidityToken}`);
        console.log(`- Provider Wallet: ${args.providerWallet}`);
        console.log(`- Liquidity Provider Address: ${args.liquidityProviderAddress}`);

        const MAX_UINT256 = hre.ethers.MaxUint256;

        const liquidityToken = await hre.ethers.getContractAt('IERC20', args.liquidityToken);
        const providerWallet = await hre.ethers.getSigner(args.providerWallet);

        const allowance = await liquidityToken.allowance(providerWallet.address, args.liquidityProviderAddress);
        const allowanceBN = BigInt(allowance);

        if (allowanceBN.toString() === '0') {
            // @ts-expect-error approve method is not defined in BaseContract
            const tx = await liquidityToken.connect(providerWallet).approve(args.liquidityProviderAddress, MAX_UINT256);
            await tx.wait();
            consoleYellow(`Allowance set for ${args.liquidityProviderAddress}`);
        } else {
            consoleRed(`Allowance already set for ${args.liquidityProviderAddress}: ${allowance.toString()}`);
        }
    });
