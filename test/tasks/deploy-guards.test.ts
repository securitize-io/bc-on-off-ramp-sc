import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { assertNotTestDouble } from '../../tasks/guards';

/**
 * The test doubles are compiled into the same artifact root as the production contracts, so the
 * generic deploy/upgrade tasks could resolve one by name on any configured network. The guard makes
 * that a deliberate act instead of an accident.
 *
 * The guard reads `hre.network.name`, which is always `hardhat` under the test runner, so the
 * network is stubbed while the real artifact repository is kept — the path signal must be exercised
 * against the actual compiled sources.
 */
const hreOnNetwork = (name: string): HardhatRuntimeEnvironment =>
    ({ network: { name }, artifacts: hre.artifacts }) as unknown as HardhatRuntimeEnvironment;

describe('Deploy task guards (assertNotTestDouble)', function () {
    describe('on a live network', function () {
        const live = () => hreOnNetwork('mainnet');

        it('rejects a test double matched by its name prefix', async function () {
            await expect(assertNotTestDouble(live(), 'MockPSMAdapter')).to.be.rejectedWith(
                /Refusing to resolve the test double "MockPSMAdapter" on network "mainnet"/,
            );
        });

        it('rejects a test double matched by its source path, bypassing the name prefix', async function () {
            // A fully qualified name does not start with `Mock`, so only the `mock/` source-path
            // signal can catch it. `getContractFactory` accepts this form, so the guard must too.
            await expect(
                assertNotTestDouble(live(), 'contracts/off-ramp/mock/MockGroveBasin.sol:MockGroveBasin'),
            ).to.be.rejectedWith(/Refusing to resolve the test double/);
        });

        it('allows a production contract', async function () {
            await expect(assertNotTestDouble(live(), 'ExternalAssetProvider')).to.not.be.rejected;
        });

        it('allows a test double when the operator opts in explicitly', async function () {
            await expect(assertNotTestDouble(live(), 'MockPSMAdapter', true)).to.not.be.rejected;
        });

        it('defers an unresolvable name to the caller instead of guessing', async function () {
            // Nothing is deployed either way, so failing open here cannot put a double on a live
            // network — the caller's own resolution reports the unknown name.
            await expect(assertNotTestDouble(live(), 'NoSuchContractAnywhere')).to.not.be.rejected;
        });
    });

    describe('on a local network', function () {
        it('allows a test double on the in-process Hardhat network', async function () {
            await expect(assertNotTestDouble(hreOnNetwork('hardhat'), 'MockPSMAdapter')).to.not.be.rejected;
        });

        it('allows a test double on a local node', async function () {
            await expect(assertNotTestDouble(hreOnNetwork('localhost'), 'MockPSMAdapter')).to.not.be.rejected;
        });
    });
});
