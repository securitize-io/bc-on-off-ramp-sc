import { task, types } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleYellow } from '../../utils';
import { assertChainId, assertFeeManagerWiring, assertFeeWithinBounds, assertIsMbpsFeeManager } from '../guards';

/** Policy ceiling applied when the caller does not narrow it: 5_000 mbps = 5%. */
const DEFAULT_MAX_MBPS = 5_000;

/**
 * Reprices an MbpsFeeManager behind read-only pre-flight assertions.
 *
 * A fee manager is shared by the on-ramp and the off-ramp protocols wired to it, so one write
 * reprices every one of them, applies from the next subscription, and has no timelock. The target is
 * therefore never implied by convention: the chain, the address and the affected ramps are all
 * explicit arguments, and each is verified before a transaction is built.
 *
 * Every assertion is read-only and fails before anything is sent:
 *   1. the connected chain matches --chain-id;
 *   2. the target holds code and reports the expected fee precision;
 *   3. the value is under 100% (the underflow bound) and under the policy ceiling;
 *   4. the signer holds DEFAULT_ADMIN_ROLE;
 *   5. every listed consumer actually consumes the target.
 *
 * The result is asserted too, not just printed: the transaction must succeed and the read-back must
 * equal the requested value.
 *
 * npx hardhat set-fee-mbps --network sepolia \
 *   --chain-id 11155111 \
 *   --fee-manager 0x... \
 *   --mbps 50 \
 *   --consumers 0xOnRamp,0xOffRamp1,0xOffRamp2
 */
task('set-fee-mbps', 'Set the fee on an MbpsFeeManager behind read-only pre-flight assertions')
    .addParam('feeManager', 'Address of the MbpsFeeManager to reprice', undefined, types.string, false)
    .addParam('mbps', 'New fee in mbps (1000 mbps = 1%)', undefined, types.int, false)
    .addParam('chainId', 'Chain id the --fee-manager and --consumers addresses belong to', undefined, types.int, false)
    .addOptionalParam(
        'consumers',
        'Comma-separated ramp addresses that must consume this fee manager',
        undefined,
        types.string,
    )
    .addOptionalParam('maxMbps', `Policy ceiling for --mbps`, DEFAULT_MAX_MBPS, types.int)
    .addFlag('dryRun', 'Run every pre-flight assertion and report the planned change without sending a transaction')
    .addFlag('allowUnwired', 'Proceed without listing --consumers, leaving the blast radius unverified')
    .setAction(async (args, hre) => {
        consoleCyan('\n task: set-fee-mbps');

        const feeManagerAddress = hre.ethers.getAddress(args.feeManager);
        const mbps = BigInt(args.mbps);
        const maxMbps = BigInt(args.maxMbps);
        const consumers: string[] = (args.consumers ?? '')
            .split(',')
            .map((consumer: string) => consumer.trim())
            .filter((consumer: string) => consumer.length > 0)
            .map((consumer: string) => hre.ethers.getAddress(consumer));

        consoleCyan('Arguments:');
        console.log(`- Fee manager: ${feeManagerAddress}`);
        console.log(`- New fee: ${mbps} mbps`);
        console.log(`- Declared chain id: ${args.chainId}`);
        console.log(`- Consumers: ${consumers.length > 0 ? consumers.join(', ') : '(none)'}`);
        console.log(`- Policy ceiling: ${maxMbps} mbps`);
        console.log(`- Dry run: ${args.dryRun}`);

        await assertChainId(hre, args.chainId);
        const feeDenominator = await assertIsMbpsFeeManager(hre, feeManagerAddress);
        assertFeeWithinBounds(mbps, maxMbps, feeDenominator);

        const [signer] = await hre.ethers.getSigners();
        console.log(`- Signer: ${signer.address}`);

        const feeManager = await hre.ethers.getContractAt('MbpsFeeManager', feeManagerAddress, signer);
        const adminRole = await feeManager.DEFAULT_ADMIN_ROLE();
        if (!(await feeManager.hasRole(adminRole, signer.address))) {
            throw new Error(
                `Signer ${signer.address} does not hold DEFAULT_ADMIN_ROLE on ${feeManagerAddress}; ` +
                    `setFeePercentageMBPS would revert.`,
            );
        }

        await assertFeeManagerWiring(hre, feeManagerAddress, consumers, args.allowUnwired);

        const previous = await feeManager.feePercentageMBPS();
        console.log(`Current fee: ${previous} mbps`);

        if (previous === mbps) {
            consoleYellow(`Fee is already ${mbps} mbps; nothing to do.`);
            return { feeManager: feeManagerAddress, previous, current: previous, changed: false };
        }

        if (args.dryRun) {
            consoleYellow(`[dry run] Would set the fee from ${previous} to ${mbps} mbps. No transaction sent.`);
            return { feeManager: feeManagerAddress, previous, current: previous, changed: false };
        }

        consoleGreen(`Setting the fee from ${previous} to ${mbps} mbps...`);
        const tx = await feeManager.setFeePercentageMBPS(mbps);
        console.log(`Transaction hash: ${tx.hash}`);

        const receipt = await tx.wait();
        if (receipt?.status !== 1) {
            throw new Error(`Transaction ${tx.hash} did not succeed (status: ${receipt?.status}).`);
        }

        const current = await feeManager.feePercentageMBPS();
        if (current !== mbps) {
            throw new Error(
                `Read-back mismatch on ${feeManagerAddress}: requested ${mbps} mbps, the contract reports ` +
                    `${current}. Investigate before assuming the fee is set.`,
            );
        }

        consoleGreen(`Fee is now ${current} mbps (confirmed in block ${receipt.blockNumber}).`);
        return { feeManager: feeManagerAddress, previous, current, changed: true, txHash: tx.hash };
    });
