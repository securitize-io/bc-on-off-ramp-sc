import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta, consoleYellow } from '../../utils';

/*
npx hardhat deploy-redemption-external-liquidity-provider-protocol \
    --network sepolia \
    --asset 0xE4d65c4657685B746C8C73da51172bE24F4601F2 \
    --nav-provider 0x8eafa966CC7d899ed76bA2194411f3181b91a063 \
    --fee-manager 0xF9D80538B0d0ceD4515f2B41910b3690d98F4E2A \
    --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
    --grove-basin 0x10b3d3A96646720f8B3a29229cF96d513f3C84F1 \
    --verify

IMPORTANT — two-step transfer requirement:
  ExternalLiquidityProvider.recipient() resolves to itself so that the off-ramp can
  deliver the asset to the provider before the Grove Basin swap takes place.  This only
  works when the off-ramp operates in two-step mode.  This task automatically enables
  that flag on SecuritizeOffRamp after deployment.  Any manual deployment of this pair
  MUST call toggleTwoStepTransfer(true) before the first redemption; omitting it causes
  the single-step flow to bypass the provider and the Grove Basin swap never executes.
*/
task('deploy-redemption-external-liquidity-provider-protocol', 'Deploy Securitize Off-Ramp + Grove Basin Liquidity Provider')
    // SecuritizeOffRamp arguments
    .addParam('asset', 'DS Token to be redeemed (e.g. BUIDL)')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')

    // ExternalLiquidityProvider arguments
    .addParam('liquidityToken', 'Stable coin delivered to the investor (e.g. USDC)')
    .addParam('groveBasin', 'Grove Basin (PSM3) contract address')
    .addOptionalParam(
        'redeemTolerance',
        'Rate divergence tolerance in units of 100_000 (1000 = 1%). Overrides the 1% contract default when set',
    )

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Suppress console output')
    .setAction(async (args, hre) => {
        if (!args.silenceLogs) {
            consoleCyan('\n task: deploy-redemption-external-liquidity-provider-protocol');
            consoleCyan('Arguments:');
            console.log(`- Asset: ${args.asset}`);
            console.log(`- NAV Provider: ${args.navProvider}`);
            console.log(`- Fee Manager: ${args.feeManager}`);
            console.log(`- Liquidity Token: ${args.liquidityToken}`);
            console.log(`- Grove Basin: ${args.groveBasin}`);
            console.log(`- Redeem Tolerance: ${args.redeemTolerance ?? '(contract default 1000 = 1%)'}`);
            console.log(`- Verify: ${args.verify}`);
        }

        // assetBurn is forced to false: ExternalLiquidityProvider receives the asset and
        // swaps it through Grove Basin — burning it beforehand is not supported.
        // ExternalLiquidityProviderOffRamp quotes calculateLiquidityTokenAmount from the Grove Basin
        // preview so the displayed amount reflects Grove Basin's own rate and fees.
        const { proxyAddress: redemptionAddress } = await hre.run('deploy-proxy', {
            contractName: 'ExternalLiquidityProviderOffRamp',
            kind: 'uups',
            args: [args.asset, args.navProvider, args.feeManager, 'false'],
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

        const redemption = await hre.ethers.getContractAt('ExternalLiquidityProviderOffRamp', redemptionAddress);
        const liquidityProvider = await hre.ethers.getContractAt(
            'ExternalLiquidityProvider',
            liquidityProviderAddress,
        );

        if (!args.silenceLogs) {
            consoleYellow(
                'Enabling two-step transfer on SecuritizeOffRamp — required by ExternalLiquidityProvider...',
            );
        }

        // ExternalLiquidityProvider.recipient() is address(this), so the redemption must
        // run in two-step mode: the off-ramp transfers the asset to the provider first, then
        // the provider swaps via Grove Basin and returns the liquidity token to the off-ramp.
        const twoStepTx = await redemption.toggleTwoStepTransfer(true);
        await twoStepTx.wait(1);

        if (!args.silenceLogs) {
            consoleYellow('Linking liquidity provider to the off-ramp contract...');
        }

        const tx = await redemption.updateLiquidityProvider(liquidityProviderAddress);
        await tx.wait(1);

        if (args.redeemTolerance !== undefined) {
            if (!args.silenceLogs) {
                consoleYellow(`Setting redeem tolerance to ${args.redeemTolerance}...`);
            }
            const toleranceTx = await liquidityProvider.setRedeemTolerance(args.redeemTolerance);
            await toleranceTx.wait(1);
        }

        if (!args.silenceLogs) {
            consoleGreen('Securitize + Grove Basin Off-Ramp Protocol deployed and configured successfully');
            consoleMagenta(`- Off-Ramp Address: ${redemptionAddress}`);
            consoleMagenta(`- Liquidity Provider Address: ${liquidityProviderAddress}`);
        }

        return { redemption, liquidityProvider };
    });

// Deploy ExternalLiquidityProvider proxy
// npx hardhat deploy-grove-basin-provider --liquidity-token 0x123 --securitize-off-ramp 0x123 --grove-basin 0x123
task('deploy-grove-basin-provider', 'Deploy ExternalLiquidityProvider proxy')
    .addParam('liquidityToken', 'Stable coin delivered to the investor (e.g. USDC)')
    .addParam('securitizeOffRamp', 'SecuritizeOffRamp proxy address')
    .addParam('groveBasin', 'Grove Basin (PSM3) contract address')
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Suppress console output')
    .setAction(async (taskArgs, hre) => {
        if (!taskArgs.silenceLogs) {
            consoleCyan('\n task: deploy-grove-basin-provider');
            consoleCyan('Arguments:');
            console.log(`- Liquidity Token: ${taskArgs.liquidityToken}`);
            console.log(`- Securitize OffRamp: ${taskArgs.securitizeOffRamp}`);
            console.log(`- Grove Basin: ${taskArgs.groveBasin}`);
        }

        const { proxyAddress, implAddress } = await hre.run('deploy-proxy', {
            contractName: 'ExternalLiquidityProvider',
            kind: 'uups',
            args: [taskArgs.liquidityToken, taskArgs.securitizeOffRamp, taskArgs.groveBasin],
            verify: taskArgs.verify,
            silenceLogs: taskArgs.silenceLogs,
        });

        return { liquidityProviderAddress: proxyAddress, liquidityProviderImpl: implAddress };
    });
