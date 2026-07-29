import hre, { ethers, upgrades } from 'hardhat';

/**
 * BC-2323 — Upgrades the deployed ExternalAssetProvider UUPS proxy so that `availableAsset()`
 * delegates to `IPSMAdapter(externalProvider).availableAsset()` instead of reading the raw asset
 * balance at the provider address.
 *
 * Why: the wired external provider is a PSM adapter that holds no asset inventory (it pushes the
 * asset from the PSM's send custodian), so the balance read returned zero and the liquidity gate in
 * `supplyExactIn` rejected every subscription with `InsufficientAssetLiquidity`.
 *
 * The change adds no state variables, so this is a pure implementation swap — the storage layout is
 * unchanged and `validateUpgrade` is run before any transaction is sent.
 *
 * Run: npx hardhat run scripts/upgrade-external-asset-provider.ts --network sepolia
 *
 * Optional env:
 *   PROXY_ADDRESS  override the proxy address (defaults to the Sepolia deployment below)
 *   VERIFY=true    verify the new implementation on Etherscan after the upgrade
 */

/** Deployed ExternalAssetProvider proxy (Sepolia). */
const DEFAULT_PROXY_ADDRESS = '0xCeCf449F2c7aa38bd31cC47aC3a8b105EFbC42Ff';

/** Network the default proxy lives on; the OZ manifest is `.openzeppelin/sepolia.json`. */
const EXPECTED_CHAIN_ID = 11155111n;

const CONTRACT_NAME = 'ExternalAssetProvider';

async function main() {
    const proxyAddress = process.env.PROXY_ADDRESS ?? DEFAULT_PROXY_ADDRESS;
    const isDefaultProxy = proxyAddress.toLowerCase() === DEFAULT_PROXY_ADDRESS.toLowerCase();

    const [signer] = await ethers.getSigners();
    if (!signer) {
        throw new Error('No signer available: set DEPLOYER_PRIV_KEY for the target network.');
    }

    const network = await ethers.provider.getNetwork();
    console.log('Network:', network.name, network.chainId.toString());
    console.log('Signer:', signer.address);
    console.log('Proxy:', proxyAddress);

    // The default address is a Sepolia deployment; refuse to touch a same-named proxy elsewhere.
    if (isDefaultProxy && network.chainId !== EXPECTED_CHAIN_ID) {
        throw new Error(
            `Proxy ${proxyAddress} is the Sepolia deployment (chainId ${EXPECTED_CHAIN_ID}), but the ` +
                `connected network reports chainId ${network.chainId}. Pass PROXY_ADDRESS explicitly to ` +
                'upgrade a different deployment.',
        );
    }

    if ((await ethers.provider.getCode(proxyAddress)) === '0x') {
        throw new Error(`No contract deployed at ${proxyAddress} on this network.`);
    }

    // ── Pre-flight ────────────────────────────────────────────────────────────
    const provider = await ethers.getContractAt(CONTRACT_NAME, proxyAddress);

    const currentImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log('Current implementation:', currentImpl);

    const externalProviderAddress = await provider.externalProvider();
    console.log('Wired externalProvider (PSM adapter):', externalProviderAddress);
    console.log('Asset:', await provider.asset());
    console.log('Liquidity token:', await provider.liquidityToken());
    console.log('NAV provider:', await provider.navProvider());
    console.log('Rate tolerance:', (await provider.rateTolerance()).toString());

    // _authorizeUpgrade is gated by DEFAULT_ADMIN_ROLE (BaseContract).
    const adminRole = await provider.DEFAULT_ADMIN_ROLE();
    const isAdmin = await provider.hasRole(adminRole, signer.address);
    console.log('Signer has DEFAULT_ADMIN_ROLE:', isAdmin);
    if (!isAdmin) {
        throw new Error('Signer does NOT have DEFAULT_ADMIN_ROLE; upgradeToAndCall would revert.');
    }

    // Old behaviour: the balance of the asset at the adapter address, expected to be 0 (the bug).
    const availableBefore = await provider.availableAsset();
    console.log('availableAsset() before (asset balance at the adapter):', availableBefore.toString());

    // The adapter must expose availableAsset(): the new implementation calls it unguarded, so a
    // provider without it would make the view — and every subscription — revert.
    const adapter = await ethers.getContractAt('IPSMAdapter', externalProviderAddress);
    let adapterCapacity: bigint;
    try {
        adapterCapacity = await adapter.availableAsset();
    } catch (error) {
        throw new Error(
            `The wired externalProvider ${externalProviderAddress} does not expose a working ` +
                `IPSMAdapter.availableAsset(): ${(error as Error).message}. Upgrading would brick ` +
                'availableAsset() and every subscription. Fix the wiring first.',
        );
    }
    console.log('IPSMAdapter.availableAsset() on the adapter:', adapterCapacity.toString());
    if (adapterCapacity === 0n) {
        console.warn(
            'WARNING: the adapter currently reports zero capacity (PSM swap disabled, inactive ' +
                'collateral/benefactor, exhausted rate limit or an unfunded send custodian). The upgrade ' +
                'is still valid, but subscriptions stay gated until the adapter reports capacity.',
        );
    }

    // ── Layout validation before sending any transaction ──────────────────────
    const Factory = await ethers.getContractFactory(CONTRACT_NAME);
    console.log('Validating storage layout compatibility...');
    await upgrades.validateUpgrade(proxyAddress, Factory, { kind: 'uups' });
    console.log('Layout is compatible.');

    // ── Upgrade ───────────────────────────────────────────────────────────────
    console.log(`Upgrading ${CONTRACT_NAME} implementation...`);
    const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, { kind: 'uups' });
    await upgraded.waitForDeployment();

    const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log('New implementation:', newImpl);
    if (newImpl.toLowerCase() === currentImpl.toLowerCase()) {
        console.log('Implementation unchanged: the compiled bytecode already matches the deployed one.');
    }

    // ── Post-flight ───────────────────────────────────────────────────────────
    const availableAfter = await provider.availableAsset();
    console.log('availableAsset() after (reported by the adapter):', availableAfter.toString());
    if (availableAfter !== adapterCapacity) {
        throw new Error(
            `Post-upgrade availableAsset() returned ${availableAfter} but the adapter reports ` +
                `${adapterCapacity}. The proxy is not delegating to the adapter as expected.`,
        );
    }
    console.log('availableAsset() now matches the adapter-reported capacity.');

    if (process.env.VERIFY === 'true') {
        console.log('Verifying the new implementation on Etherscan...');
        await hre.run('verify:verify', { address: newImpl, constructorArguments: [] });
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
