import { HardhatRuntimeEnvironment } from 'hardhat/types';

/**
 * Networks where deploying a test double is legitimate: an in-process Hardhat network or a local
 * node. Every other network is treated as live.
 */
const LOCAL_NETWORKS = new Set(['hardhat', 'localhost']);

/**
 * Source-path segment marking a contract as a test-only double. The mocks live under
 * `contracts/mock/` and `contracts/off-ramp/mock/`, both matched by this segment.
 */
const TEST_DOUBLE_SOURCE_SEGMENT = '/mock/';

/** Name prefix used by every test double in this repository. */
const TEST_DOUBLE_NAME_PREFIX = /^Mock/;

/**
 * Minimal ABI for reading a ramp's configured fee manager.
 *
 * Both ramp families expose the same getter — the on-ramp as `IFeeManager public feeManager`, the
 * off-ramp as `address public feeManager` — so one signature covers every consumer without binding
 * this guard to a contract name.
 */
const FEE_MANAGER_CONSUMER_ABI = ['function feeManager() view returns (address)'];

/**
 * Fee precision an {MbpsFeeManager} is expected to report.
 *
 * An mbps value is meaningless without it: 1000 mbps is 1% only while the denominator is 100_000.
 * A fee manager reporting a different precision (the six-decimal test doubles report 100_000_000)
 * would reinterpret the same number by a factor of 1000, so the denominator is asserted rather than
 * assumed.
 */
const EXPECTED_FEE_DENOMINATOR = 100_000n;

/**
 * Reports whether a contract resolves to a test-only double.
 *
 * Two independent signals, so a double is caught even when the artifact cannot be read (not yet
 * compiled, or an ambiguous name): its source path under a `mock/` directory, and its `Mock` name
 * prefix. The path check is the authoritative one; the name check is the fallback.
 */
const isTestDouble = async (hre: HardhatRuntimeEnvironment, contractName: string): Promise<boolean> => {
    if (TEST_DOUBLE_NAME_PREFIX.test(contractName)) {
        return true;
    }
    try {
        const { sourceName } = await hre.artifacts.readArtifact(contractName);
        return sourceName.toLowerCase().includes(TEST_DOUBLE_SOURCE_SEGMENT);
    } catch {
        // Unknown or ambiguous name: let the caller's own resolution report it. Nothing is deployed
        // either way, so failing open here cannot put a double on a live network.
        return false;
    }
};

/**
 * Rejects deploying or upgrading to a test-only double on a live network.
 *
 * The mocks are compiled into the same artifact root as the production contracts, so a generic
 * task that resolves a contract by name can otherwise put one on any configured network. Wiring a
 * double as a counterparty is an administrator mistake this guard cannot prevent, but resolving it
 * by name through these tasks is a step that no longer happens by accident.
 *
 * Deploying a double to a shared testnet is a legitimate integration-testing need, so the block is
 * an explicit opt-in (`--allow-test-double`) rather than a hard denial.
 *
 * @param hre Hardhat runtime environment, used for the network name and artifact lookup.
 * @param contractName Contract name the task is about to resolve.
 * @param allowTestDouble Operator's explicit opt-in, from the task's `--allow-test-double` flag.
 * @throws When `contractName` resolves to a test double on a live network without the opt-in.
 */
export const assertNotTestDouble = async (
    hre: HardhatRuntimeEnvironment,
    contractName: string,
    allowTestDouble = false,
): Promise<void> => {
    if (allowTestDouble || LOCAL_NETWORKS.has(hre.network.name)) {
        return;
    }
    if (await isTestDouble(hre, contractName)) {
        throw new Error(
            `Refusing to resolve the test double "${contractName}" on network "${hre.network.name}". ` +
                `Test doubles are compiled alongside the production contracts but must never be deployed ` +
                `to a live network. Pass --allow-test-double if this is a deliberate deployment to a ` +
                `test network.`,
        );
    }
};

/**
 * Rejects running against a chain other than the one the caller declared.
 *
 * The network is selected at run time by `--network` while the address arguments belong to exactly
 * one chain. The same deployer key is configured for every network in this project, so an address
 * can resolve, match an ABI and pass a role check on the wrong chain. Binding the declared chain id
 * to the call site turns that into a pre-flight failure instead of a misdirected write.
 *
 * @param hre Hardhat runtime environment, used for the provider and the network name.
 * @param expectedChainId Chain id the caller's address arguments belong to.
 * @throws When the connected chain id differs from `expectedChainId`.
 */
export const assertChainId = async (hre: HardhatRuntimeEnvironment, expectedChainId: number): Promise<void> => {
    const { chainId } = await hre.ethers.provider.getNetwork();
    if (chainId !== BigInt(expectedChainId)) {
        throw new Error(
            `Refusing to continue: connected to chain ${chainId} via network "${hre.network.name}", but the ` +
                `caller declared chain ${expectedChainId}. The address arguments belong to one chain only — ` +
                `check the --network flag before retrying.`,
        );
    }
};

/**
 * Confirms the target really is an {MbpsFeeManager} reporting the expected fee precision.
 *
 * Two failure modes this catches before any write: nothing deployed at the address (a stale address,
 * or the right address on the wrong chain), and a fee manager whose `FEE_DENOMINATOR` differs from
 * {EXPECTED_FEE_DENOMINATOR}, which would silently rescale the caller's mbps value.
 *
 * @param hre Hardhat runtime environment, used for the provider and artifact resolution.
 * @param feeManagerAddress Address the caller intends to reprice.
 * @returns The fee denominator read from the contract, for the caller's own bounds check.
 * @throws When the address holds no code, does not answer `FEE_DENOMINATOR()`, or reports an
 *         unexpected precision.
 */
export const assertIsMbpsFeeManager = async (
    hre: HardhatRuntimeEnvironment,
    feeManagerAddress: string,
): Promise<bigint> => {
    if ((await hre.ethers.provider.getCode(feeManagerAddress)) === '0x') {
        throw new Error(
            `No contract code at ${feeManagerAddress} on network "${hre.network.name}". The address is ` +
                `either stale or belongs to a different chain.`,
        );
    }

    let feeDenominator: bigint;
    try {
        const feeManager = await hre.ethers.getContractAt('MbpsFeeManager', feeManagerAddress);
        feeDenominator = await feeManager.FEE_DENOMINATOR();
    } catch (error) {
        throw new Error(
            `The contract at ${feeManagerAddress} does not answer FEE_DENOMINATOR(); it is not an ` +
                `MbpsFeeManager (${error instanceof Error ? error.message : String(error)}).`,
        );
    }

    if (feeDenominator !== EXPECTED_FEE_DENOMINATOR) {
        throw new Error(
            `The fee manager at ${feeManagerAddress} reports FEE_DENOMINATOR ${feeDenominator}, expected ` +
                `${EXPECTED_FEE_DENOMINATOR}. The same mbps value means a different percentage at that ` +
                `precision, so the write is refused.`,
        );
    }

    return feeDenominator;
};

/**
 * Rejects a fee value outside the two bounds that matter, each for a different reason.
 *
 * The hard bound is `fee < feeDenominator`. Both ramps compute the net liquidity as `amount - fee`
 * (`BaseOnRamp._executeLiquidityTransfer`, `PublicStockOnRamp.subscribe`), so a fee at or above 100%
 * makes every subscription revert on underflow — a protocol-wide outage from one admin typo, and one
 * the caller's slippage floor cannot absorb because the subtraction happens first. The fee manager
 * itself does not enforce this, so the check lives here.
 *
 * The soft bound is the caller's policy ceiling. It is deliberately kept off-chain: a business
 * ceiling can legitimately change, and coupling it to a contract constant would require an upgrade
 * to move it.
 *
 * @param mbps Fee the caller intends to set, in mbps (1000 mbps = 1%).
 * @param maxMbps Policy ceiling the caller accepts.
 * @param feeDenominator Fee precision read from the target contract, where `feeDenominator` = 100%.
 * @throws When `mbps` is negative, at or above 100%, or above the policy ceiling.
 */
export const assertFeeWithinBounds = (mbps: bigint, maxMbps: bigint, feeDenominator: bigint): void => {
    if (mbps < 0n) {
        throw new Error(`Refusing to set a negative fee (${mbps} mbps).`);
    }
    if (mbps >= feeDenominator) {
        throw new Error(
            `Refusing to set a fee of ${mbps} mbps: that is 100% or more at a denominator of ` +
                `${feeDenominator}. Both ramps compute the net liquidity as \`amount - fee\`, so every ` +
                `subscription would revert on underflow until an admin reverses it.`,
        );
    }
    if (mbps > maxMbps) {
        throw new Error(
            `Refusing to set a fee of ${mbps} mbps: it exceeds the policy ceiling of ${maxMbps} mbps. ` +
                `Raise the ceiling explicitly if this is intended.`,
        );
    }
};

/**
 * Rejects a fee manager the intended consumers do not actually consume.
 *
 * A fee manager is shared: one write reprices every ramp wired to it. Reading `feeManager()` back
 * from each ramp the caller means to affect turns a stale or undocumented instance into a loud
 * failure instead of a silent no-op on the ramps that matter.
 *
 * Listing no consumers is the dangerous default, so it must be opted into. `allowUnwired` waives the
 * requirement to list them — it does not skip verification of consumers that *are* listed.
 *
 * @param hre Hardhat runtime environment, used for the provider and address normalisation.
 * @param feeManagerAddress Fee manager the caller intends to reprice.
 * @param consumers Ramp addresses that must report `feeManagerAddress` as their fee manager.
 * @param allowUnwired Caller's explicit opt-in to running without any consumer listed.
 * @throws When `consumers` is empty without the opt-in, or any consumer reports a different fee
 *         manager or cannot be read.
 */
export const assertFeeManagerWiring = async (
    hre: HardhatRuntimeEnvironment,
    feeManagerAddress: string,
    consumers: string[],
    allowUnwired = false,
): Promise<void> => {
    if (consumers.length === 0) {
        if (allowUnwired) {
            return;
        }
        throw new Error(
            `Refusing to reprice ${feeManagerAddress} without knowing which ramps consume it. List them ` +
                `with --consumers, or pass --allow-unwired to proceed with the blast radius unverified.`,
        );
    }

    const expected = hre.ethers.getAddress(feeManagerAddress);
    const mismatches: string[] = [];

    for (const consumer of consumers) {
        const ramp = new hre.ethers.Contract(consumer, FEE_MANAGER_CONSUMER_ABI, hre.ethers.provider);
        try {
            const wired = hre.ethers.getAddress(await ramp.feeManager());
            if (wired !== expected) {
                mismatches.push(`${consumer} consumes ${wired}`);
            }
        } catch (error) {
            mismatches.push(
                `${consumer} does not answer feeManager() (${error instanceof Error ? error.message : String(error)})`,
            );
        }
    }

    if (mismatches.length > 0) {
        throw new Error(
            `Wiring check failed for fee manager ${expected} on network "${hre.network.name}":\n` +
                mismatches.map((mismatch) => `  - ${mismatch}`).join('\n') +
                `\nRepricing it would not affect these ramps. Verify the target address before retrying.`,
        );
    }
};
