/**
 * Sets the allowance provider wallet for the liquidity provider contract and updates the liquidity provider
 * address in the SecuritizeOffRamp contract. This step links the deployed AllowanceLiquidityProvider with
 * the SecuritizeOffRamp, enabling the redemption protocol to interact with the correct liquidity provider.
 *
 * @param args.provider - The wallet address that will provide liquidity.
 * @param liquidityProvider - The deployed AllowanceLiquidityProvider contract instance.
 * @param redemption - The deployed SecuritizeOffRamp contract instance.
 */
import { task, types } from 'hardhat/config';

// Deploy SecuritizeOffRamp proxy
// npx hardhat deploy-offramp --asset 0x123 --navProvider 0x123 --feeManager 0x123 --assetBurn false
task('deploy-offramp', 'Deploy SecuritizeOffRamp proxy')
    .addParam('asset', 'DS Token to be redeemed', undefined, types.string, false)
    .addParam('navProvider', 'NAV rate provider address', undefined, types.string, false)
    .addParam('feeManager', 'Fee manager address', undefined, types.string, false)
    .addParam('assetBurn', 'Whether assets should be burned on redemption', false, types.boolean, true)
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        const result = await hre.run('deploy-proxy', {
            contractName: 'SecuritizeOffRamp',
            args: [taskArgs.asset, taskArgs.navProvider, taskArgs.feeManager, taskArgs.assetBurn],
            kind: 'uups',
        });

        const redemptionAddress = result.proxyAddress;
        const redemptionImpl = result.implAddress;

        console.log(`Securitize Redemption Proxy address: ${redemptionAddress}`);
        console.log(`Securitize Redemption Implementation address: ${redemptionImpl}`);

        if (taskArgs.verify) {
            try {
                console.log('Verifying contracts on Etherscan...');
                await hre.run('verify-implementation', {
                    address: redemptionImpl,
                    contractName: 'SecuritizeOffRamp',
                    args: [],
                });
                console.log('Contracts verified successfully.');
            } catch (error) {
                console.error(`Verification failed: ${error}`);
            }
        }

        return { redemptionAddress, redemptionImpl };
    });

// Deploy AllowanceLiquidityProvider proxy
// npx hardhat deploy-allowance-provider --liquidityToken 0x123 --recipient 0x123 --redemptionAddress 0x123
task('deploy-allowance-provider', 'Deploy AllowanceLiquidityProvider proxy')
    .addParam('liquidityToken', 'Stable coin to provide liquidity', undefined, types.string, false)
    .addParam('recipient', 'Wallet that receives DS Token', undefined, types.string, false)
    .addParam('redemptionAddress', 'SecuritizeOffRamp proxy address', undefined, types.string, false)
    .addFlag('verify', 'Verify contracts on Etherscan')
    .setAction(async (taskArgs, hre) => {
        const result = await hre.run('deploy-proxy', {
            contractName: 'AllowanceLiquidityProvider',
            args: [taskArgs.liquidityToken, taskArgs.recipient, taskArgs.redemptionAddress],
            kind: 'uups',
        });

        const liquidityProviderAddress = result.proxyAddress;
        const liquidityProviderImpl = result.implAddress;

        console.log(`Liquidity Provider Proxy address: ${liquidityProviderAddress}`);
        console.log(`Liquidity Provider Implementation address: ${liquidityProviderImpl}`);

        if (taskArgs.verify) {
            try {
                console.log('Verifying contracts on Etherscan...');
                await hre.run('verify-implementation', {
                    address: liquidityProviderImpl,
                    contractName: 'AllowanceLiquidityProvider',
                    args: [],
                });
                console.log('Contracts verified successfully.');
            } catch (error) {
                console.error(`Verification failed: ${error}`);
            }
        }

        return { liquidityProviderAddress, liquidityProviderImpl };
    });

/*
    npx hardhat deploy-redemption-allowance-protocol
    --network sepolia
    --asset 0x123
    --navProvider 0x123
    --feeManager 0x123
    --recipient 0x123
    --liquidityToken 0x123
    --provider 0x123
    --verify
*/
task('deploy-redemption-allowance-protocol', 'Deploy Redemption Protocol (Allowance implementation)')
    // SecuritizeOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed', undefined, types.string, false)
    .addParam('navProvider', 'NAV rate provider address', undefined, types.string, false)
    .addParam('feeManager', 'Fee manager address', undefined, types.string, false)
    .addParam('assetBurn', 'Whether assets should be burned on redemption', false, types.boolean, true)
    // AllowanceLiquidityProvider arguments
    .addParam('recipient', 'Wallet that receives DS Token', undefined, types.string, false)
    .addParam('liquidityToken', 'Stable coin to provide liquidity', undefined, types.string, false)
    .addParam('provider', 'Wallet that provides liquidity', undefined, types.string, false)
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
        await liquidityProvider.setAllowanceProviderWallet(args.provider);

        // Set liquidity provider on securitize redemption contract
        await redemption.updateLiquidityProvider(liquidityProviderAddress);

        console.log('Securitize Redemption Protocol has been configured successfully');

        return { redemption, liquidityProvider };
    });
