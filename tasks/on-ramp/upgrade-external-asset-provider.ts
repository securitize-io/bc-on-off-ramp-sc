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
unchanged and validateUpgrade runs before any transaction is sent. Contract verification is out of
scope — use the `verify-contract` task on the reported implementation address if needed.

After the upgrade the task calls availableAsset() on the proxy to confirm the new implementation is
wired correctly. That call reverts when the wired externalProvider does not expose
IPSMAdapter.availableAsset(), which would leave the provider unable to serve subscriptions.
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

        if (!taskArgs.silenceLogs) {
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

        // Post-upgrade confirmation: availableAsset() must now resolve through the wired external
        // provider. A revert here means the externalProvider does not expose
        // IPSMAdapter.availableAsset(), so the provider cannot serve subscriptions.
        const provider = await hre.ethers.getContractAt(contractName, proxyAddress);
        const externalProvider = await provider.externalProvider();
        let availableAsset: bigint;
        try {
            availableAsset = await provider.availableAsset();
        } catch (error) {
            if (!taskArgs.silenceLogs) {
                consoleRed(`availableAsset() reverted after the upgrade: ${(error as Error).message}`);
            }
            throw new Error(
                `${contractName} at ${proxyAddress} was upgraded, but availableAsset() reverts. The wired ` +
                    `externalProvider ${externalProvider} must expose IPSMAdapter.availableAsset(); fix the ` +
                    'wiring with setExternalProvider before subscriptions can be served.',
            );
        }

        if (!taskArgs.silenceLogs) {
            console.log(`Wired externalProvider: ${externalProvider}`);
            console.log(`availableAsset(): ${availableAsset.toString()}`);
            if (availableAsset === 0n) {
                consoleYellow(
                    'WARNING: the external provider reports zero deliverable capacity (PSM swap disabled, ' +
                        'unconfigured or inactive collateral/benefactor, exhausted rate limit or an unfunded ' +
                        'send custodian). The upgrade is correct, but subscriptions stay gated until it ' +
                        'reports capacity.',
                );
            }
            consoleGreen(`${contractName} upgraded and availableAsset() resolves through the external provider.`);
        }

        return { proxyAddress, previousImplementation, newImplementation, externalProvider, availableAsset };
    });
