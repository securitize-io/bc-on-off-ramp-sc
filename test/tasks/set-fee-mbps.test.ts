import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { AssetProviderType } from '../../tasks';
import { assertFeeManagerWiring, assertFeeWithinBounds } from '../../tasks/guards';

/**
 * The fee manager is shared by every ramp wired to it and its setter has no bound of its own, so the
 * guards on this task are the only thing standing between an operator typo and a protocol-wide
 * repricing. They are exercised against real contracts — a real MbpsFeeManager behind a UUPS proxy
 * and a real SecuritizeOnRamp wired to it — because what is being tested is the wiring the guards
 * read back, not a stubbed answer.
 */

/** Fee the fixture starts at, so a no-op write is distinguishable from a real one. */
const INITIAL_MBPS = 100n;

/**
 * Deploys a real MbpsFeeManager plus a real on-ramp that consumes it.
 *
 * The `deploy-on-ramp` task takes the fee manager as an argument, which is what makes a genuine
 * wiring match reachable: no ramp exposes a fee-manager setter, so the only way to have one point at
 * a specific instance is to deploy it that way.
 */
const deployFeeManagerWithConsumer = async () => {
    const [deployer, custodianWallet, feeCollector, assetProviderWallet, outsider] = await hre.ethers.getSigners();

    const FeeManager = await hre.ethers.getContractFactory('MbpsFeeManager');
    const feeManager = await hre.upgrades.deployProxy(FeeManager, [INITIAL_MBPS, feeCollector.address], {
        kind: 'uups',
    });
    await feeManager.waitForDeployment();
    const feeManagerAddress = await feeManager.getAddress();

    const mockRegistryService = await hre.ethers.deployContract('MockRegistryService', []);
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        6,
        await mockRegistryService.getAddress(),
        await mockTrustService.getAddress(),
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    const navMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [1e6]);

    const { onRamp } = await hre.run('deploy-on-ramp', {
        token: await dsTokenMock.getAddress(),
        liquidity: await usdcMock.getAddress(),
        nav: await navMock.getAddress(),
        fee: feeManagerAddress,
        custodian: custodianWallet.address,
        type: AssetProviderType.ALLOWANCE.toString(),
        provider: assetProviderWallet.address,
    });
    const onRampAddress = await onRamp.getAddress();

    // A second fee manager that nothing consumes: the stale/undocumented instance the wiring check
    // exists to catch.
    const unwired = await hre.upgrades.deployProxy(FeeManager, [INITIAL_MBPS, feeCollector.address], { kind: 'uups' });
    await unwired.waitForDeployment();

    const { chainId } = await hre.ethers.provider.getNetwork();

    return {
        feeManager,
        feeManagerAddress,
        onRampAddress,
        unwiredAddress: await unwired.getAddress(),
        chainId: Number(chainId),
        deployer,
        feeCollector,
        outsider,
    };
};

describe('set-fee-mbps task', function () {
    describe('chain binding', function () {
        it('rejects a chain id that does not match the connected network', async function () {
            const { feeManagerAddress, onRampAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: feeManagerAddress,
                    mbps: 50,
                    chainId: chainId + 1,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/connected to chain \d+ via network "hardhat", but the caller declared chain/);
        });
    });

    describe('target identity', function () {
        it('rejects an address that holds no contract code', async function () {
            const { onRampAddress, chainId, outsider } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: outsider.address,
                    mbps: 50,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/No contract code at .* The address is either stale or belongs to a different chain/);
        });

        it('rejects a fee manager reporting a different fee precision', async function () {
            // MockConfigurableFeeManager reports 100_000_000, so the same mbps value would mean a
            // percentage 1000x smaller than the caller intends.
            const { onRampAddress, chainId, feeCollector } = await loadFixture(deployFeeManagerWithConsumer);
            const sixDecimals = await hre.ethers.deployContract('MockConfigurableFeeManager', [
                0n,
                feeCollector.address,
            ]);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: await sixDecimals.getAddress(),
                    mbps: 50,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/reports FEE_DENOMINATOR 100000000, expected 100000/);
        });
    });

    describe('value bounds', function () {
        it('rejects a fee at or above 100% even when the policy ceiling allows it', async function () {
            const { feeManagerAddress, onRampAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: feeManagerAddress,
                    mbps: 100_000,
                    maxMbps: 200_000,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/that is 100% or more at a denominator of 100000/);
        });

        it('rejects a fee above the policy ceiling', async function () {
            const { feeManagerAddress, onRampAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: feeManagerAddress,
                    mbps: 6_000,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/exceeds the policy ceiling of 5000 mbps/);
        });

        it('rejects a negative fee', function () {
            expect(() => assertFeeWithinBounds(-1n, 5_000n, 100_000n)).to.throw(
                /Refusing to set a negative fee \(-1 mbps\)/,
            );
        });

        it('accepts a fee at the policy ceiling', function () {
            expect(() => assertFeeWithinBounds(5_000n, 5_000n, 100_000n)).to.not.throw();
        });
    });

    describe('authority', function () {
        it('rejects a signer without DEFAULT_ADMIN_ROLE', async function () {
            // BaseContract grants DEFAULT_ADMIN_ROLE to whoever initialises the proxy, so deploying
            // from a different signer leaves the task's own signer (signers[0]) without it.
            const { onRampAddress, chainId, outsider, feeCollector } = await loadFixture(deployFeeManagerWithConsumer);
            const FeeManager = await hre.ethers.getContractFactory('MbpsFeeManager', outsider);
            const foreign = await hre.upgrades.deployProxy(FeeManager, [INITIAL_MBPS, feeCollector.address], {
                kind: 'uups',
            });
            await foreign.waitForDeployment();

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: await foreign.getAddress(),
                    mbps: 50,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/does not hold DEFAULT_ADMIN_ROLE on .*setFeePercentageMBPS would revert/s);
        });
    });

    describe('wiring', function () {
        it('rejects a target no listed consumer consumes', async function () {
            const { unwiredAddress, onRampAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: unwiredAddress,
                    mbps: 50,
                    chainId,
                    consumers: onRampAddress,
                }),
            ).to.be.rejectedWith(/Wiring check failed for fee manager .*consumes/s);
        });

        it('rejects a consumer that does not answer feeManager()', async function () {
            const { feeManagerAddress, chainId, outsider } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', {
                    feeManager: feeManagerAddress,
                    mbps: 50,
                    chainId,
                    consumers: outsider.address,
                }),
            ).to.be.rejectedWith(/does not answer feeManager\(\)/);
        });

        it('refuses to run with no consumer listed unless opted in', async function () {
            const { feeManagerAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(
                hre.run('set-fee-mbps', { feeManager: feeManagerAddress, mbps: 50, chainId }),
            ).to.be.rejectedWith(/without knowing which ramps consume it/);
        });

        it('accepts a consumer wired to the target', async function () {
            const { feeManagerAddress, onRampAddress } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(assertFeeManagerWiring(hre, feeManagerAddress, [onRampAddress])).to.not.be.rejected;
        });

        it('verifies listed consumers even when the opt-in is passed', async function () {
            // --allow-unwired waives the requirement to list consumers; it does not waive checking
            // the ones that are listed.
            const { unwiredAddress, onRampAddress } = await loadFixture(deployFeeManagerWithConsumer);

            await expect(assertFeeManagerWiring(hre, unwiredAddress, [onRampAddress], true)).to.be.rejectedWith(
                /Wiring check failed/,
            );
        });
    });

    describe('execution', function () {
        it('writes the fee and confirms the read-back', async function () {
            const { feeManager, feeManagerAddress, onRampAddress, chainId } =
                await loadFixture(deployFeeManagerWithConsumer);

            const result = await hre.run('set-fee-mbps', {
                feeManager: feeManagerAddress,
                mbps: 50,
                chainId,
                consumers: onRampAddress,
            });

            expect(result.changed).to.equal(true);
            expect(result.previous).to.equal(INITIAL_MBPS);
            expect(result.current).to.equal(50n);
            expect(await feeManager.feePercentageMBPS()).to.equal(50n);
        });

        it('emits FeeUpdated with the old and new value', async function () {
            const { feeManager, feeManagerAddress, onRampAddress, chainId } =
                await loadFixture(deployFeeManagerWithConsumer);

            const result = await hre.run('set-fee-mbps', {
                feeManager: feeManagerAddress,
                mbps: 50,
                chainId,
                consumers: onRampAddress,
            });

            const events = await feeManager.queryFilter(feeManager.filters.FeeUpdated(), -1);
            expect(events).to.have.lengthOf(1);
            expect(events[0].transactionHash).to.equal(result.txHash);
            expect(events[0].args[0]).to.equal(INITIAL_MBPS);
            expect(events[0].args[1]).to.equal(50n);
        });

        it('sends no transaction when the fee already matches', async function () {
            const { feeManager, feeManagerAddress, onRampAddress, chainId } =
                await loadFixture(deployFeeManagerWithConsumer);

            const result = await hre.run('set-fee-mbps', {
                feeManager: feeManagerAddress,
                mbps: Number(INITIAL_MBPS),
                chainId,
                consumers: onRampAddress,
            });

            expect(result.changed).to.equal(false);
            expect(result.txHash).to.equal(undefined);
            expect(await feeManager.feePercentageMBPS()).to.equal(INITIAL_MBPS);
        });

        it('leaves the fee untouched on a dry run', async function () {
            const { feeManager, feeManagerAddress, onRampAddress, chainId } =
                await loadFixture(deployFeeManagerWithConsumer);

            const result = await hre.run('set-fee-mbps', {
                feeManager: feeManagerAddress,
                mbps: 50,
                chainId,
                consumers: onRampAddress,
                dryRun: true,
            });

            expect(result.changed).to.equal(false);
            expect(result.txHash).to.equal(undefined);
            expect(await feeManager.feePercentageMBPS()).to.equal(INITIAL_MBPS);
        });

        it('writes with the opt-in when no consumer is listed', async function () {
            const { feeManager, feeManagerAddress, chainId } = await loadFixture(deployFeeManagerWithConsumer);

            const result = await hre.run('set-fee-mbps', {
                feeManager: feeManagerAddress,
                mbps: 50,
                chainId,
                allowUnwired: true,
            });

            expect(result.changed).to.equal(true);
            expect(await feeManager.feePercentageMBPS()).to.equal(50n);
        });
    });
});
