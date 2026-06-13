import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta, consoleYellow } from '../../utils';

/*
npx hardhat deploy-third-party-protocol \
    --network sepolia \
    --asset 0xE4d65c4657685B746C8C73da51172bE24F4601F2 \
    --nav-provider 0x8eafa966CC7d899ed76bA2194411f3181b91a063 \
    --fee-manager 0xF9D80538B0d0ceD4515f2B41910b3690d98F4E2A \
    --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
    --grove-basin 0x10b3d3A96646720f8B3a29229cF96d513f3C84F1 \
    --operator 0xcBeEe2c39601e1ee5502F2593F6758e6598C47a6 \
    --verify
*/
task('deploy-third-party-protocol', 'Deploy Grove Basin Off-Ramp Protocol (instant swap implementation)')
    // ThirdPartyOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed (e.g. BUIDL)')
    .addParam('navProvider', 'NAV rate provider address (1:1 parity rate)')
    .addParam('feeManager', 'Fee manager address (fee initialized to zero)')

    // GroveBasinLiquidityProvider arguments
    .addParam('liquidityToken', 'Stable coin delivered to the investor (e.g. USDC)')
    .addParam('groveBasin', 'Grove Basin (PSM3) contract address')

    // Access control
    .addOptionalParam('operator', 'Wallet granted the OPERATOR_ROLE to trigger swaps')

    // Redeem tolerance (scaled to 100_000 == 100%); defaults to the contract value when omitted
    .addOptionalParam('redeemTolerance', 'Redeem tolerance scaled to 100_000 (e.g. 5000 == 5%)')

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Verbose output')
    .setAction(async (args, hre) => {
        if (!args.silenceLogs) {
            consoleCyan('\n task: deploy-third-party-protocol');
            consoleCyan('Arguments:');
            console.log(`- Asset: ${args.asset}`);
            console.log(`- NAV Provider: ${args.navProvider}`);
            console.log(`- Fee Manager: ${args.feeManager}`);
            console.log(`- Liquidity Token: ${args.liquidityToken}`);
            console.log(`- Grove Basin: ${args.groveBasin}`);
            console.log(`- Operator: ${args.operator}`);
            console.log(`- Redeem Tolerance: ${args.redeemTolerance ?? '(contract default)'}`);
            console.log(`- Verify: ${args.verify}`);
        }

        const { redemptionAddress } = await hre.run('deploy-grove-basin-offramp', {
            asset: args.asset,
            navProvider: args.navProvider,
            feeManager: args.feeManager,
            verify: args.verify,
            silenceLogs: args.silenceLogs,
        });

        const { liquidityProviderAddress } = await hre.run('deploy-grove-basin-provider', {
            liquidityToken: args.liquidityToken,
            securitizeOffRamp: redemptionAddress,
            groveBasin: args.groveBasin,
            verify: args.verify,
            silenceLogs: args.silenceLogs,
        });

        // Get contract instances
        const redemption = await hre.ethers.getContractAt('ThirdPartyOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'GroveBasinLiquidityProvider',
            liquidityProviderAddress,
        );

        if (!args.silenceLogs) {
            consoleYellow('Linking liquidity provider to the off-ramp contract...');
        }

        // Set liquidity provider on the off-ramp contract
        const tx = await redemption.updateLiquidityProvider(liquidityProviderAddress);
        await tx.wait(1);

        // Override the redeem tolerance when explicitly provided
        if (args.redeemTolerance !== undefined) {
            const toleranceTx = await redemption.setRedeemTolerance(args.redeemTolerance);
            await toleranceTx.wait(1);
            if (!args.silenceLogs) {
                console.log(`Set redeem tolerance to ${args.redeemTolerance}`);
            }
        }

        // Grant the operator role so it can trigger swaps
        if (args.operator) {
            const operatorTx = await redemption.addOperator(args.operator);
            await operatorTx.wait(1);
            if (!args.silenceLogs) {
                console.log(`Granted OPERATOR_ROLE to ${args.operator}`);
            }
        }

        if (!args.silenceLogs) {
            consoleGreen('Grove Basin Off-Ramp Protocol has been deployed and configured successfully');
            consoleMagenta(`- Off-Ramp Address: ${redemptionAddress}`);
            consoleMagenta(`- Liquidity Provider Address: ${liquidityProviderAddress}`);
        }

        return { redemption, liquidityProvider };
    });

// Deploy ThirdPartyOffRamp proxy
// npx hardhat deploy-grove-basin-offramp --asset 0x123 --nav-provider 0x123 --fee-manager 0x123 --verify
task('deploy-grove-basin-offramp', 'Deploy ThirdPartyOffRamp proxy')
    .addParam('asset', 'DS Token to be redeemed (e.g. BUIDL)')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Verbose output')
    .setAction(async (taskArgs, hre) => {
        if (!taskArgs.silenceLogs) {
            consoleCyan('\n task: deploy-grove-basin-offramp');
        }

        // assetBurn is forced to false: the asset is the swap input and cannot be burned.
        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'ThirdPartyOffRamp',
            kind: 'uups',
            args: [taskArgs.asset, taskArgs.navProvider, taskArgs.feeManager, 'false'],
            verify: taskArgs.verify,
            silenceLogs: taskArgs.silenceLogs,
        });

        return { redemptionAddress: proxyAddress, redemptionImpl: implAddress };
    });

// Deploy GroveBasinLiquidityProvider proxy
// npx hardhat deploy-grove-basin-provider --liquidity-token 0x123 --securitize-off-ramp 0x123 --grove-basin 0x123
task('deploy-grove-basin-provider', 'Deploy GroveBasinLiquidityProvider proxy')
    .addParam('liquidityToken', 'Stable coin delivered to the investor (e.g. USDC)')
    .addParam('securitizeOffRamp', 'ThirdPartyOffRamp proxy address')
    .addParam('groveBasin', 'Grove Basin (PSM3) contract address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Verbose output')
    .setAction(async (taskArgs, hre) => {
        if (!taskArgs.silenceLogs) {
            consoleCyan('\n task: deploy-grove-basin-provider');
            consoleCyan('Arguments:');
            console.log(`- Liquidity Token: ${taskArgs.liquidityToken}`);
            console.log(`- Securitize OffRamp: ${taskArgs.securitizeOffRamp}`);
            console.log(`- Grove Basin: ${taskArgs.groveBasin}`);
        }

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'GroveBasinLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidityToken, taskArgs.securitizeOffRamp, taskArgs.groveBasin],
            verify: taskArgs.verify,
            silenceLogs: taskArgs.silenceLogs,
        });

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });
