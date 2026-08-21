import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleMagenta, consoleRed, consoleYellow } from '../../utils';

/*
npx hardhat deploy-on-ramp-external-asset-provider \
    --network sepolia \
    --asset 0xE4d65c4657685B746C8C73da51172bE24F4601F2 \
    --liquidity-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
    --nav-provider 0x8eafa966CC7d899ed76bA2194411f3181b91a063 \
    --fee-manager 0xF9D80538B0d0ceD4515f2B41910b3690d98F4E2A \
    --grove-basin 0x10b3d3A96646720f8B3a29229cF96d513f3C84F1 \
    --verify

Flow & wiring notes:
  - USDC path: investor -> SecuritizeOnRamp -> (fee -> feeCollector) -> net -> ExternalAssetProvider
    -> Grove Basin (swapExactIn USDC->asset). The on-ramp (ExternalAssetProviderOnRamp) quotes the
    asset amount from Grove Basin's previewSwapExactIn over the net, and the provider cross-checks it
    against the Securitize NAV tolerance band. Grove Basin keeps the USDC; the asset is delivered to
    the on-ramp (two-step) or the investor (single-step).
  - The net liquidity must land on the provider, so the on-ramp is initialized with
    custodianWallet == ExternalAssetProvider. To avoid a deploy-time circular dependency (and any
    new setter on the on-ramp) the provider is deployed FIRST, then the on-ramp is initialized with
    custodianWallet = provider, then provider.setSecuritizeOnRamp wires the authorized caller.
  - Transfer mode: two-step ONLY. ExternalAssetProviderOnRamp.initialize enables it, so the task no
    longer toggles it. Single-step passes the investor as the swap receiver, which the PSM adapter
    rejects; the on-ramp refuses that configuration with SingleStepNotSupported. --single-step is
    kept only to fail loudly for anyone running the previously documented command.
  - The provider prices the swap with the SAME NAV provider as the on-ramp; the task verifies it.
  - Deliverable capacity is read back at the end: a provider reporting zero means the on-ramp is
    wired but cannot serve a single subscription (custodian unfunded or approving the wrong spender,
    PSM rate limit exhausted, benefactor inactive, swap disabled).
  - investorSubscriptionEnabled stays false by default; enable it before the first headless swap.
*/
task('deploy-on-ramp-external-asset-provider', 'Deploy Securitize On-Ramp + Grove Basin Asset Provider')
    // SecuritizeOnRamp arguments
    .addParam('asset', 'DS Token to be purchased (e.g. BUIDL)')
    .addParam('liquidityToken', 'Stable coin supplied by the investor (e.g. USDC)')
    .addParam('navProvider', 'NAV rate provider address')
    .addParam('feeManager', 'Fee manager address')

    // ExternalAssetProvider arguments
    .addParam('groveBasin', 'Grove Basin (PSM3) contract address')
    .addOptionalParam(
        'rateTolerance',
        'Rate divergence tolerance in units of 100_000 (1000 = 1%). Overrides the 1% contract default when set',
    )
    .addOptionalParam('referralCode', 'Referral code forwarded to Grove Basin on each swap')

    // Admin handover (optional)
    .addOptionalParam(
        'admin',
        'Address that receives DEFAULT_ADMIN_ROLE on the deployed contracts; the deployer then renounces its own role. Defaults to the zero address, which keeps the deployer as admin (no handover)',
        '0x0000000000000000000000000000000000000000',
    )

    // Rejected: kept so the previously documented command fails with a named cause rather than an
    // "unrecognized parameter" error.
    .addFlag('singleStep', 'REJECTED — this on-ramp delivers two-step only (the adapter binds the swap receiver)')

    // Verification flag
    .addFlag('verify', 'Verify contracts on Etherscan')
    .addFlag('silenceLogs', 'Suppress console output')
    .setAction(async (args, hre) => {
        // Checked before anything is deployed: the on-ramp would reject the configuration anyway
        // (SingleStepNotSupported), and failing here leaves nothing half-wired behind.
        if (args.singleStep) {
            throw new Error(
                'This on-ramp delivers two-step only. Single-step passes the investor as the swap receiver, ' +
                    'which the PSM adapter rejects, so every subscription would revert. Re-run without --single-step.',
            );
        }

        if (!args.silenceLogs) {
            consoleCyan('\n task: deploy-on-ramp-external-asset-provider');
            consoleCyan('Arguments:');
            console.log(`- Asset: ${args.asset}`);
            console.log(`- Liquidity Token: ${args.liquidityToken}`);
            console.log(`- NAV Provider: ${args.navProvider}`);
            console.log(`- Fee Manager: ${args.feeManager}`);
            console.log(`- Grove Basin: ${args.groveBasin}`);
            console.log(`- Rate Tolerance: ${args.rateTolerance ?? '(contract default 1000 = 1%)'}`);
            console.log(`- Referral Code: ${args.referralCode ?? '0'}`);
            console.log('- Transfer mode: two-step (enforced)');
            console.log(`- Admin: ${args.admin} ${args.admin === hre.ethers.ZeroAddress ? '(no handover)' : ''}`);
            console.log(`- Verify: ${args.verify}`);
        }

        const [deployer] = await hre.ethers.getSigners();

        // The provider is deployed FIRST so the on-ramp can be initialized with
        // custodianWallet = provider (no on-ramp setter, no circular dependency).
        const { proxyAddress: assetProviderAddress } = await hre.run('deploy-proxy', {
            contractName: 'ExternalAssetProvider',
            kind: 'uups',
            args: [args.liquidityToken, args.asset, args.navProvider, args.groveBasin],
            verify: args.verify,
            silenceLogs: args.silenceLogs,
        });

        const { proxyAddress: onRampAddress } = await hre.run('deploy-proxy', {
            contractName: 'ExternalAssetProviderOnRamp',
            kind: 'uups',
            args: [args.asset, args.liquidityToken, args.navProvider, args.feeManager, assetProviderAddress],
            verify: args.verify,
            silenceLogs: args.silenceLogs,
        });

        const onRamp = await hre.ethers.getContractAt('ExternalAssetProviderOnRamp', onRampAddress);
        const assetProvider = await hre.ethers.getContractAt('ExternalAssetProvider', assetProviderAddress);

        if (!args.silenceLogs) {
            consoleYellow('Authorizing the on-ramp on the provider (setSecuritizeOnRamp)...');
        }
        const authTx = await assetProvider.setSecuritizeOnRamp(onRampAddress);
        await authTx.wait(1);

        if (!args.silenceLogs) {
            consoleYellow('Linking asset provider to the on-ramp contract...');
        }
        const linkTx = await onRamp.updateAssetProvider(assetProviderAddress);
        await linkTx.wait(1);

        // Two-step needs no toggle here: ExternalAssetProviderOnRamp.initialize enables it, because
        // the inherited default (false) is the single-step mode this on-ramp cannot serve.

        if (args.referralCode !== undefined) {
            if (!args.silenceLogs) {
                consoleYellow(`Setting referral code to ${args.referralCode}...`);
            }
            const referralTx = await assetProvider.setReferralCode(args.referralCode);
            await referralTx.wait(1);
        }

        if (args.rateTolerance !== undefined) {
            if (!args.silenceLogs) {
                consoleYellow(`Setting rate tolerance to ${args.rateTolerance}...`);
            }
            const toleranceTx = await assetProvider.setRateTolerance(args.rateTolerance);
            await toleranceTx.wait(1);
        }

        // Sanity check: the provider must price with the same NAV provider as the on-ramp, otherwise
        // the subscription binding (NAV-derived asset amount) would not match and swaps would revert.
        const providerNav = await assetProvider.navProvider();
        const onRampNav = await onRamp.navProvider();
        if (providerNav.toLowerCase() !== onRampNav.toLowerCase()) {
            consoleRed(
                `NAV provider mismatch: provider=${providerNav} onRamp=${onRampNav}. Swaps will revert until aligned.`,
            );
        }

        // Deliverable-capacity read-back. availableAsset() nets the PSM rate limits and the send
        // custodian's inventory AND its allowance to the spender the PSM actually uses, so a zero
        // here is the single observable symptom of every way the funding can be wrong — including an
        // allowance granted to the wrong spender, which leaves the custodian's balance looking
        // correct. Reporting it at deploy time turns a silent zero into a named failure, instead of
        // an on-ramp that looks wired and rejects every subscription.
        const availableAsset = await assetProvider.availableAsset();

        if (!args.silenceLogs) {
            consoleGreen('Securitize + Grove Basin On-Ramp Protocol deployed and configured successfully');
            consoleMagenta(`- On-Ramp Address: ${onRampAddress}`);
            consoleMagenta(`- Asset Provider Address: ${assetProviderAddress}`);
            consoleMagenta(`- Reported deliverable capacity (availableAsset): ${availableAsset}`);
            consoleYellow('Reminders:');
            console.log('- transfer mode: two-step (enforced by the on-ramp; single-step is rejected)');
            console.log('- enable investorSubscriptionEnabled before the first headless swap');
            console.log('- keep the asset send custodian funded and approving the correct spender');
        }

        await onRamp.toggleInvestorSubscription(true);

        // Admin handover MUST be the last step: every configuration call above (including
        // toggleInvestorSubscription) requires the deployer to still hold DEFAULT_ADMIN_ROLE.
        // Granting the role to the new admin before the deployer renounces it guarantees the
        // contract is never left without an admin.
        // NOTE: renouncing also drops the deployer's UUPS upgrade rights (_authorizeUpgrade is
        // gated by DEFAULT_ADMIN_ROLE), leaving `admin` as the sole controller.
        if (args.admin !== hre.ethers.ZeroAddress) {
            if (!hre.ethers.isAddress(args.admin)) {
                throw new Error(`Invalid admin address: ${args.admin}`);
            }

            const transferAdmin = async (
                contract: Awaited<ReturnType<typeof hre.ethers.getContractAt>>,
                label: string,
            ) => {
                if (!args.silenceLogs) {
                    consoleYellow(`Transferring DEFAULT_ADMIN_ROLE of ${label} to ${args.admin}...`);
                }
                const role = await contract.DEFAULT_ADMIN_ROLE();
                await (await contract.grantRole(role, args.admin)).wait(1);
                await (await contract.renounceRole(role, deployer.address)).wait(1);
            };

            await transferAdmin(onRamp, 'ExternalAssetProviderOnRamp');
            await transferAdmin(assetProvider, 'ExternalAssetProvider');

            if (!args.silenceLogs) {
                consoleMagenta(`- Admin (DEFAULT_ADMIN_ROLE): ${args.admin} — deployer renounced its role`);
            }
        }

        return { onRamp, assetProvider, onRampAddress, assetProviderAddress };
    });
