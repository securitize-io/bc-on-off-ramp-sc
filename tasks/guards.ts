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
