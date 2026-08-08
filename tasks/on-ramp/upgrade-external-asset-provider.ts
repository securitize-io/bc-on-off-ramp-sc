import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleRed, consoleYellow } from '../../utils';

/*
npx hardhat upgrade-external-asset-provider \
    --network sepolia \
    --proxy-address 0xCeCf449F2c7aa38bd31cC47aC3a8b105EFbC42Ff

BC-2323: upgrades the ExternalAssetProvider implementation so that availableAsset() delegates to
IPSMAdapter(externalProvider).availableAsset() instead of reading the raw asset balance at the
provider address. The wired external provider is a PSM adapter that holds no asset inventory (it
pushes the asset from the PSM's send custodian), so the balance read returned zero and the liquidity
gate in supplyExactIn rejected every subscription with InsufficientAssetLiquidity.

The change adds no state variables, so this is a pure implementation swap: the storage layout is
unchanged. Contract verification is out of scope — use the `verify-contract` task on the reported
implementation address if needed.

Every precondition is checked BEFORE any transaction is sent, because none of them can be undone
afterwards:
  - the proxy holds code;
  - the storage layout is compatible (validateUpgrade);
  - the wired externalProvider answers IPSMAdapter.availableAsset(). The new implementation
    delegates to it unguarded, so a provider without that function would make the view — and
    therefore every subscription — revert. The candidate is probed directly, which answers the same
    question as calling the upgraded proxy would, without changing any state.

The task also reports the pause flag: supplyExactIn is `whenNotPaused` while availableAsset() is
not, and the upgrade itself applies normally against a paused proxy, so a successful upgrade on a
paused provider still leaves every subscription reverting. The task never unpauses — that would
re-open the subscription path as a side effect of an upgrade command.
*/
task('upgrade-external-asset-provider', 'Upgrade an ExternalAssetProvider UUPS proxy implementation')
    .addParam('proxyAddress', 'ExternalAssetProvider proxy address to upgrade')
    .addFlag('silenceLogs', 'Suppress console output')
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile', { quiet: taskArgs.silenceLogs });

        const contractName = 'ExternalAssetProvider';
        // Throws on a malformed address instead of sending a transaction into the void.
        const proxyAddress = hre.ethers.getAddress(taskArgs.proxyAddress);

        if (!taskArgs.silenceLogs) {
            consoleCyan('\n task: upgrade-external-asset-provider');
            consoleCyan('Arguments:');
            console.log(`- Proxy address: ${proxyAddress}`);
        }

        if ((await hre.ethers.provider.getCode(proxyAddress)) === '0x') {
            throw new Error(`No contract deployed at ${proxyAddress} on this network.`);
        }

        const previousImplementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
        if (!taskArgs.silenceLogs) {
            console.log(`Current implementation at:`);
            consoleYellow(`${previousImplementation}`);
        }

        // Layout check before any transaction is sent.
        const Contract = await hre.ethers.getContractFactory(contractName);
        await hre.upgrades.validateUpgrade(proxyAddress, Contract, { kind: 'uups' });

        // Compatibility check, also before any transaction is sent. `externalProvider` is inherited
        // state the pre-upgrade proxy already exposes, so the wired provider can be probed directly:
        // that answers the same question as calling availableAsset() on the upgraded proxy would,
        // and a failure here aborts while the upgrade is still undone.
        const provider = await hre.ethers.getContractAt(contractName, proxyAddress);
        const externalProvider = await provider.externalProvider();
        const adapter = await hre.ethers.getContractAt('IPSMAdapter', externalProvider);

        // Capacity read the upgraded implementation will delegate to.
        let adapterAvailableAsset: bigint;
        try {
            adapterAvailableAsset = await adapter.availableAsset();
        } catch (error) {
            // Surface what the probe actually observed rather than asserting one root cause. The raw
            // revert data matters on a live network, where the node cannot name a custom error the
            // local artifacts do not declare.
            const revertData = (error as { data?: unknown }).data;
            const reason =
                typeof revertData === 'string' && revertData !== '0x'
                    ? `${(error as Error).message} (revert data: ${revertData})`
                    : (error as Error).message;
            if (!taskArgs.silenceLogs) {
                consoleRed(`availableAsset() on the wired externalProvider reverted: ${reason}`);
            }
            throw new Error(
                `Aborting before the upgrade: the wired externalProvider ${externalProvider} of ` +
                    `${contractName} at ${proxyAddress} does not answer IPSMAdapter.availableAsset(). The new ` +
                    'implementation delegates to it unguarded, so upgrading now would make every subscription ' +
                    `revert. Underlying error: ${reason}`,
                { cause: error },
            );
        }

        // Pre-upgrade reading of the same view under the OLD semantics (raw asset balance at the
        // provider address). Reported as migration evidence: a value that differs from the
        // post-upgrade one proves the swap took effect. Purely informational, so a revert here (an
        // older implementation whose balance path fails) must not abort an otherwise valid upgrade.
        let previousAvailableAsset: bigint | undefined;
        try {
            previousAvailableAsset = await provider.availableAsset();
        } catch {
            previousAvailableAsset = undefined;
        }

        // supplyExactIn is `whenNotPaused`; availableAsset() is not, and _authorizeUpgrade carries no
        // pause gate either. A paused provider therefore upgrades cleanly while every subscription
        // keeps reverting, so the flag has to be reported rather than inferred from the capacity read.
        const paused: boolean = await provider.paused();

        if (!taskArgs.silenceLogs) {
            console.log(`Wired externalProvider: ${externalProvider}`);
            console.log(`externalProvider.availableAsset(): ${adapterAvailableAsset.toString()}`);
            consoleGreen(`Upgrading ${contractName} at ${proxyAddress}...`);
        }
        const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, Contract, { kind: 'uups' });
        await upgraded.waitForDeployment();

        const newImplementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
        if (!taskArgs.silenceLogs) {
            console.log(`Proxy upgraded at: ${proxyAddress}`);
            console.log(`New implementation at:`);
            consoleYellow(`${newImplementation}`);
            if (newImplementation.toLowerCase() === previousImplementation.toLowerCase()) {
                console.log('Implementation unchanged: the compiled bytecode already matches the deployed one.');
            }
        }

        // Migration evidence: the upgraded proxy must now report exactly what the adapter reports.
        // This only discriminates at non-zero capacity — both the old (balance at the adapter, which
        // holds no inventory) and the new (delegated) implementation return zero otherwise — so a
        // zero reading is reported as unconfirmed rather than as a successful migration.
        const availableAsset: bigint = await provider.availableAsset();
        const adapterAfter: bigint = await adapter.availableAsset();
        const migrationConfirmed = availableAsset === adapterAfter && adapterAfter !== 0n;

        if (availableAsset !== adapterAfter) {
            if (!taskArgs.silenceLogs) {
                consoleRed(
                    `availableAsset() reports ${availableAsset.toString()} while the adapter reports ` +
                        `${adapterAfter.toString()}: the proxy is NOT delegating to the external provider.`,
                );
            }
            throw new Error(
                `${contractName} at ${proxyAddress} does not delegate availableAsset() to the wired ` +
                    `externalProvider ${externalProvider} after the upgrade (proxy ` +
                    `${availableAsset.toString()} vs adapter ${adapterAfter.toString()}).`,
            );
        }

        if (!taskArgs.silenceLogs) {
            console.log(`availableAsset(): ${availableAsset.toString()}`);
            if (!migrationConfirmed) {
                consoleYellow(
                    'WARNING: the external provider reports zero deliverable capacity (PSM swap disabled, ' +
                        'unconfigured or inactive collateral/benefactor, exhausted rate limit or an unfunded ' +
                        'send custodian). Both the old and the new implementation return zero in that state, ' +
                        'so the migration is UNCONFIRMED by this read; the implementation address above is the ' +
                        'evidence. Subscriptions stay gated until the provider reports capacity.',
                );
            }
            if (paused) {
                consoleYellow(
                    `WARNING: ${contractName} at ${proxyAddress} is PAUSED. The upgrade applied and ` +
                        'availableAsset() resolves, but supplyExactIn reverts until unpause() is called - ' +
                        'subscriptions are NOT restored.',
                );
            }
            if (migrationConfirmed && !paused) {
                consoleGreen(`${contractName} upgraded and availableAsset() resolves through the external provider.`);
            }
        }

        return {
            proxyAddress,
            previousImplementation,
            newImplementation,
            externalProvider,
            availableAsset,
            previousAvailableAsset,
            adapterAvailableAsset: adapterAfter,
            migrationConfirmed,
            paused,
        };
    });
