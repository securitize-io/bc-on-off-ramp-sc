/**
 * Sets the allowance provider wallet for the liquidity provider contract and updates the liquidity provider
 * address in the SecuritizeOffRamp contract. This step links the deployed AllowanceLiquidityProvider with
 * the SecuritizeOffRamp, enabling the redemption protocol to interact with the correct liquidity provider.
 *
 * @param args.provider - The wallet address that will provide liquidity.
 * @param liquidityProvider - The deployed AllowanceLiquidityProvider contract instance.
 * @param redemption - The deployed SecuritizeOffRamp contract instance.
 */
import { task } from 'hardhat/config';

// Deploy SecuritizeOffRamp proxy
// npx hardhat deploy-offramp --network sepolia --asset 0x779877a7b0d9e8603169ddbd7836e478b4624789 --nav-provider 0xe76B92272667363FD487a71c13b7799ED924C9b8 --fee-manager 0xe76B92272667363FD487a71c13b7799ED924C9b8 --asset-burn false --verify
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

        const result = await hre.run('deploy-proxy', {
            contractName: 'SecuritizeOffRamp',
            args: [taskArgs.asset, taskArgs.navProvider, taskArgs.feeManager, taskArgs.assetBurn],
            kind: 'uups',
        });

        const redemptionAddress = result.proxyAddress;
        const redemptionImpl = result.implAddress;

        console.log(`Securitize Redemption Proxy address: ${redemptionAddress}`);
        console.log(`Securitize Redemption Implementation address: ${redemptionImpl}`);
        console.log('');

        if (taskArgs.verify) {
            try {
                console.log('Verifying contracts on Etherscan...');
                await hre.run('verify-implementation', {
                    address: redemptionImpl,
                    contractName: 'contracts/off-ramp/SecuritizeOffRamp.sol:SecuritizeOffRamp',
                    args: [],
                });
                console.log('Contracts verified successfully.');
            } catch (error) {
                console.error(`Verification failed: ${error}`);
            }
            console.log('');
        }

        return { redemptionAddress, redemptionImpl };
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
                    contractName: 'contracts/off-ramp/AllowanceLiquidityProvider.sol:AllowanceLiquidityProvider',
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
npx hardhat deploy-redemption-allowance-protocol \
    --network sepolia \
    --asset 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --nav-provider 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --fee-manager 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --asset-burn false \
    --recipient 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
    --liquidity-token 0xe76B92272667363FD487a71c13b7799ED924C9b8 \
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
