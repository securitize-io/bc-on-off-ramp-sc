import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {
    deployOnRampExternalAssetProvider,
    deployOnRampExternalAssetProvider6x18,
    deployOnRampExternalAssetProvider18x6,
    deployOnRampExternalAssetProviderSingleStep,
    prepareSwap,
    setGbPreviewFactor,
    calcFee,
    FEE_CASES,
    TOLERANCE_DENOMINATOR,
    DEFAULT_RATE_TOLERANCE,
    FEE_COLLECTOR,
} from './external-asset-provider.fixture';

const MIN_OUT = 0n;

describe('On-Ramp External Asset Provider (swapExactIn via Grove Basin quote)', function () {
    describe('Creation & initialization', function () {
        it('stores the configured wiring', async function () {
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, navProviderMock } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );
            expect(await assetProvider.liquidityToken()).to.equal(await usdcMock.getAddress());
            expect(await assetProvider.asset()).to.equal(await dsTokenMock.getAddress());
            expect(await assetProvider.securitizeOnRamp()).to.equal(await onRamp.getAddress());
            expect(await assetProvider.navProvider()).to.equal(await navProviderMock.getAddress());
            expect(await assetProvider.externalProvider()).to.equal(await groveBasinMock.getAddress());
            expect(await assetProvider.rateTolerance()).to.equal(DEFAULT_RATE_TOLERANCE);
            expect(await assetProvider.TOLERANCE_DENOMINATOR()).to.equal(TOLERANCE_DENOMINATOR);
            // custodianWallet must point at the provider so net USDC settles there before the swap.
            expect(await onRamp.custodianWallet()).to.equal(await assetProvider.getAddress());
            expect(await onRamp.assetProvider()).to.equal(await assetProvider.getAddress());
            // provider and on-ramp must price with the same NAV provider for the binding to hold.
            expect(await assetProvider.navProvider()).to.equal(await onRamp.navProvider());
            // two-step is the default for RWA compliance (asset delivered from the on-ramp).
            expect(await onRamp.twoStepTransfer()).to.equal(true);
        });

        it('cannot be initialized twice', async function () {
            const { assetProvider, usdcMock, dsTokenMock, navProviderMock, groveBasinMock } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );
            await expect(
                assetProvider.initialize(
                    await usdcMock.getAddress(),
                    await dsTokenMock.getAddress(),
                    await navProviderMock.getAddress(),
                    await groveBasinMock.getAddress(),
                ),
            ).revertedWithCustomError(assetProvider, 'InvalidInitialization');
        });

        it('reports version and implementation', async function () {
            const { assetProvider } = await loadFixture(deployOnRampExternalAssetProvider);
            expect(await assetProvider.getInitializedVersion()).to.equal(1);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(await assetProvider.getImplementationAddress()).to.exist;
        });

        it('reverts on zero address arguments', async function () {
            const { usdcMock, dsTokenMock, navProviderMock, groveBasinMock } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );
            const Factory = await hre.ethers.getContractFactory('ExternalAssetProvider');
            const ok = [
                await usdcMock.getAddress(),
                await dsTokenMock.getAddress(),
                await navProviderMock.getAddress(),
                await groveBasinMock.getAddress(),
            ];
            for (let i = 0; i < 4; i++) {
                const args = [...ok];
                args[i] = hre.ethers.ZeroAddress;
                await expect(hre.upgrades.deployProxy(Factory, args, { kind: 'uups' })).revertedWithCustomError(
                    Factory,
                    'NonZeroAddressError',
                );
            }
        });

        // initialize() validates the Grove Basin wiring via _validateExternalProviderConfig
        // (initialize -> __BaseExternalProvider_init -> _setExternalProvider).
        describe('Grove Basin config validation at initialize', function () {
            const deployProxyWith = async (
                groveBasin: string,
                ctx: Awaited<ReturnType<typeof deployOnRampExternalAssetProvider>>,
            ) => {
                const Factory = await hre.ethers.getContractFactory('ExternalAssetProvider');
                const promise = hre.upgrades.deployProxy(
                    Factory,
                    [
                        await ctx.usdcMock.getAddress(),
                        await ctx.dsTokenMock.getAddress(),
                        await ctx.navProviderMock.getAddress(),
                        groveBasin,
                    ],
                    { kind: 'uups' },
                );
                return { Factory, promise };
            };

            it('reverts when the Grove Basin address is not a contract', async function () {
                const ctx = await loadFixture(deployOnRampExternalAssetProvider);
                const { Factory, promise } = await deployProxyWith(ctx.stranger.address, ctx);
                await expect(promise).revertedWithCustomError(Factory, 'NotAContract');
            });

            it('reverts when collateralToken does not match the liquidity token', async function () {
                const ctx = await loadFixture(deployOnRampExternalAssetProvider);
                // collateralToken = DSToken (not USDC)
                const wrongBasin = await hre.ethers.deployContract('MockGroveBasin', [
                    await ctx.dsTokenMock.getAddress(),
                ]);
                await wrongBasin.setCreditToken(await ctx.dsTokenMock.getAddress());
                const { Factory, promise } = await deployProxyWith(await wrongBasin.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'CollateralTokenMismatch');
            });

            it('reverts when creditToken does not match the asset', async function () {
                const ctx = await loadFixture(deployOnRampExternalAssetProvider);
                // collateralToken = USDC (ok) but creditToken = USDC (not the asset)
                const wrongBasin = await hre.ethers.deployContract('MockGroveBasin', [await ctx.usdcMock.getAddress()]);
                await wrongBasin.setCreditToken(await ctx.usdcMock.getAddress());
                const { Factory, promise } = await deployProxyWith(await wrongBasin.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'CreditTokenMismatch');
            });

            it('reverts when the Grove Basin pocket is the zero address', async function () {
                const ctx = await loadFixture(deployOnRampExternalAssetProvider);
                const zeroPocket = await hre.ethers.deployContract('MockGroveBasinZeroPocket', [
                    await ctx.usdcMock.getAddress(),
                    await ctx.dsTokenMock.getAddress(),
                ]);
                const { Factory, promise } = await deployProxyWith(await zeroPocket.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'PocketZeroAddressError');
            });
        });
    });

    describe('setSecuritizeOnRamp', function () {
        it('validates and emits, restricted to admin', async function () {
            const { assetProvider, onRamp, stranger } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(assetProvider.connect(stranger).setSecuritizeOnRamp(stranger.address)).revertedWithCustomError(
                assetProvider,
                'AccessControlUnauthorizedAccount',
            );

            await expect(assetProvider.setSecuritizeOnRamp(hre.ethers.ZeroAddress)).revertedWithCustomError(
                assetProvider,
                'NonZeroAddressError',
            );

            await expect(assetProvider.setSecuritizeOnRamp(stranger.address))
                .to.emit(assetProvider, 'SecuritizeOnRampUpdated')
                .withArgs(await onRamp.getAddress(), stranger.address);
            expect(await assetProvider.securitizeOnRamp()).to.equal(stranger.address);
        });
    });

    describe('updateNavProvider', function () {
        it('validates, emits and updates state, restricted to admin', async function () {
            const { assetProvider, stranger, navProviderMock, zeroRateNavProviderMock } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );

            await expect(
                assetProvider.connect(stranger).updateNavProvider(await zeroRateNavProviderMock.getAddress()),
            ).revertedWithCustomError(assetProvider, 'AccessControlUnauthorizedAccount');

            await expect(assetProvider.updateNavProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                assetProvider,
                'NonZeroAddressError',
            );

            await expect(assetProvider.updateNavProvider(await zeroRateNavProviderMock.getAddress()))
                .to.emit(assetProvider, 'NavProviderUpdated')
                .withArgs(await navProviderMock.getAddress(), await zeroRateNavProviderMock.getAddress());
            expect(await assetProvider.navProvider()).to.equal(await zeroRateNavProviderMock.getAddress());
        });

        it('rewires the NAV used in the rate-band cross-check and realigns a bricked provider', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, investor, navProviderMock, zeroRateNavProviderMock } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);

            // Point the provider's NAV to a zero-rate source: the band cross-check now reverts,
            // bricking every subscription while the on-ramp's NAV stays healthy.
            await assetProvider.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'NonZeroNavRateError',
            );

            // Realign the provider back with the on-ramp's NAV: subscriptions recover with no upgrade.
            await assetProvider.updateNavProvider(await navProviderMock.getAddress());
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).to.emit(onRamp, 'Swap');
            expect(await ctx.dsTokenMock.balanceOf(investor.address)).to.equal(expected);
        });
    });

    describe('Admin configuration', function () {
        it('setExternalProvider validations and event', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { assetProvider, usdcMock, dsTokenMock, groveBasinMock, stranger } = ctx;

            await expect(
                assetProvider.connect(stranger).setExternalProvider(await groveBasinMock.getAddress()),
            ).revertedWithCustomError(assetProvider, 'AccessControlUnauthorizedAccount');

            await expect(assetProvider.setExternalProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                assetProvider,
                'NonZeroAddressError',
            );

            await expect(assetProvider.setExternalProvider(stranger.address)).revertedWithCustomError(
                assetProvider,
                'NotAContract',
            );

            const wrongCredit = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await wrongCredit.setCreditToken(await usdcMock.getAddress());
            await expect(assetProvider.setExternalProvider(await wrongCredit.getAddress())).revertedWithCustomError(
                assetProvider,
                'CreditTokenMismatch',
            );

            const newBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await newBasin.setCreditToken(await dsTokenMock.getAddress());
            await expect(assetProvider.setExternalProvider(await newBasin.getAddress()))
                .to.emit(assetProvider, 'ExternalProviderUpdated')
                .withArgs(await groveBasinMock.getAddress(), await newBasin.getAddress());
            expect(await assetProvider.externalProvider()).to.equal(await newBasin.getAddress());
        });

        it('setReferralCode and setRateTolerance validations and events', async function () {
            const { assetProvider, stranger } = await loadFixture(deployOnRampExternalAssetProvider);

            await expect(assetProvider.connect(stranger).setReferralCode(7)).revertedWithCustomError(
                assetProvider,
                'AccessControlUnauthorizedAccount',
            );
            await expect(assetProvider.setReferralCode(7)).to.emit(assetProvider, 'ReferralCodeUpdated').withArgs(0, 7);

            await expect(assetProvider.setRateTolerance(TOLERANCE_DENOMINATOR + 1n))
                .revertedWithCustomError(assetProvider, 'InvalidRateToleranceError')
                .withArgs(TOLERANCE_DENOMINATOR + 1n);
            await expect(assetProvider.setRateTolerance(2_000n))
                .to.emit(assetProvider, 'RateToleranceUpdated')
                .withArgs(DEFAULT_RATE_TOLERANCE, 2_000n);
        });

        it('only admin can pause/unpause', async function () {
            const { assetProvider, stranger } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(assetProvider.connect(stranger).pause()).revertedWithCustomError(
                assetProvider,
                'AccessControlUnauthorizedAccount',
            );
            await assetProvider.pause();
            await assetProvider.unpause();
        });
    });

    describe('availableAsset', function () {
        it('reflects the Grove Basin asset balance', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { assetProvider, dsTokenMock, groveBasinMock } = ctx;
            expect(await assetProvider.availableAsset()).to.equal(0n);
            await dsTokenMock.mint(await groveBasinMock.getAddress(), 123_456n);
            expect(await assetProvider.availableAsset()).to.equal(123_456n);
        });
    });

    describe('Transfer modes (exact 1:1 delivery)', function () {
        it('two-step (default) delivers exactly the NAV amount via the on-ramp, no dust', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected, net } = await prepareSwap(ctx, gross, 0n);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected);
            // asset routed Grove Basin -> on-ramp -> investor; nothing stranded anywhere.
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
            expect(await dsTokenMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            // Grove Basin consumed exactly the net USDC; provider keeps no treasury.
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });

        it('single-step delivers exactly the NAV amount straight to the investor', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProviderSingleStep);
            const { onRamp, dsTokenMock, investor } = ctx;
            expect(await onRamp.twoStepTransfer()).to.equal(false);

            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
        });
    });

    describe('Swap (happy path, 1:1 peg)', function () {
        const cases = [
            { label: '6x6', fixture: deployOnRampExternalAssetProvider, lDec: 6 },
            { label: '6x18', fixture: deployOnRampExternalAssetProvider6x18, lDec: 18 },
            { label: '18x6', fixture: deployOnRampExternalAssetProvider18x6, lDec: 6 },
        ];

        for (const c of cases) {
            it(`delivers the exact asset and consumes the net USDC (${c.label})`, async function () {
                const ctx = await loadFixture(c.fixture);
                const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;

                const gross = 1_000n * 10n ** BigInt(c.lDec);
                const { expected, net } = await prepareSwap(ctx, gross, 0n);

                await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).to.emit(onRamp, 'Swap');

                expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected);
                expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
                expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            });
        }
    });

    describe('Swap with fees', function () {
        for (const fee of FEE_CASES) {
            it(`handles fee ${fee.label}`, async function () {
                const ctx = await deployOnRampExternalAssetProvider(6, 6, fee.numerator);
                const { onRamp, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;

                const gross = 1_000_000_000n; // 1000 USDC; net > 0 even at 99.999999%
                const expectedFee = calcFee(gross, fee.numerator);
                const { net, expected } = await prepareSwap(ctx, gross, fee.numerator);
                expect((await onRamp.calculateDsTokenAmount(gross))[2]).to.equal(expectedFee);

                await onRamp.connect(investor).swap(gross, MIN_OUT);

                expect(await usdcMock.balanceOf(FEE_COLLECTOR)).to.equal(expectedFee);
                expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
                expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected);
            });
        }
    });

    describe('Swap binding (donation resilience)', function () {
        it('ignores a liquidity donation to the provider: swap succeeds and the donation is retained', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor, stranger } = ctx;

            const gross = 1_000_000_000n;
            const { expected, net } = await prepareSwap(ctx, gross, 0n);

            // An arbitrary (non-investor) address donates USDC to the provider before the swap.
            const DONATION = 1_000_000n; // 1 USDC
            await usdcMock.mint(stranger.address, DONATION);
            await usdcMock.connect(stranger).transfer(await assetProvider.getAddress(), DONATION);

            // The swap is bound to the net liquidity (not the on-hand balance), so it still succeeds
            // and delivers exactly the expected asset amount.
            await onRamp.connect(investor).swap(gross, MIN_OUT);
            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected);

            // Only the net was swapped into Grove Basin; the donation stays on the provider (recoverable
            // via rescueTokens), never swept into the buyer's subscription.
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(DONATION);
        });

        it('remains live for subsequent subscriptions after a donation (no permanent brick)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor, stranger } = ctx;

            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);

            // Fund a second subscription: extra asset in Grove Basin + extra USDC and a 2x approval.
            await dsTokenMock.mint(await groveBasinMock.getAddress(), expected);
            await usdcMock.mint(investor.address, gross);
            await usdcMock.connect(investor).approve(await onRamp.getAddress(), gross * 2n);

            const DONATION = 7n;
            await usdcMock.mint(stranger.address, DONATION);
            await usdcMock.connect(stranger).transfer(await assetProvider.getAddress(), DONATION);

            await onRamp.connect(investor).swap(gross, MIN_OUT);
            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(expected * 2n);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(DONATION);
        });
    });

    describe('rescueTokens', function () {
        it('lets the admin recover a donation and reverts for a non-admin caller', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { assetProvider, usdcMock, stranger } = ctx;
            const DONATION = 1_234n;
            await usdcMock.mint(await assetProvider.getAddress(), DONATION);

            await expect(
                assetProvider.connect(stranger).rescueTokens(await usdcMock.getAddress(), stranger.address, DONATION),
            ).revertedWithCustomError(assetProvider, 'AccessControlUnauthorizedAccount');

            await expect(assetProvider.rescueTokens(await usdcMock.getAddress(), stranger.address, DONATION))
                .to.emit(assetProvider, 'TokensRescued')
                .withArgs(await usdcMock.getAddress(), stranger.address, DONATION);
            expect(await usdcMock.balanceOf(stranger.address)).to.equal(DONATION);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });

        it('reverts when rescuing to the zero address', async function () {
            const { assetProvider, usdcMock } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(
                assetProvider.rescueTokens(await usdcMock.getAddress(), hre.ethers.ZeroAddress, 0n),
            ).revertedWithCustomError(assetProvider, 'NonZeroAddressError');
        });
    });

    describe('Grove Basin quote within band is delivered (no dust)', function () {
        // The whole point of quoting from Grove Basin: a benign NAV/Grove Basin divergence (within the
        // tolerance band) is delivered to the investor instead of reverting. A 0.1% Grove Basin fee is
        // well inside the default 1% band.
        const GB_FEE_BPS = 10n; // 0.1%
        const withGbFee = (expected: bigint) => expected - (expected * GB_FEE_BPS + 9_999n) / 10_000n;

        it('two-step delivers the Grove Basin amount (NAV minus a 0.1% Grove Basin fee), no dust', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected, net } = await prepareSwap(ctx, gross, 0n);
            await groveBasinMock.setRedemptionFeeBps(GB_FEE_BPS);
            const delivered = withGbFee(expected);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            // Investor receives the real Grove Basin output; nothing stranded on the on-ramp/provider.
            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(delivered);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
            expect(await dsTokenMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });

        it('single-step delivers the Grove Basin amount straight to the investor', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProviderSingleStep);
            const { onRamp, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);
            await groveBasinMock.setRedemptionFeeBps(GB_FEE_BPS);
            const delivered = withGbFee(expected);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(delivered);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
        });

        // Mode B analog: in the old swapExactOut design a Grove Basin quote *better* than the NAV
        // (Grove needing less input than the settled balance) reverted with LiquidityNotFullyConsumed,
        // even inside the tolerance band. The exact-in binding has no leftover check, so an
        // above-parity quote inside the band is delivered straight to the investor.
        it('delivers when Grove Basin quotes 0.5% above NAV, inside the band (no LiquidityNotFullyConsumed)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const net = gross; // 0% Securitize fee => net == gross
            // Grove Basin quotes 0.5% MORE asset than the NAV parity — well within the 1% band.
            const delivered = (net * 1_005n) / 1_000n;
            await prepareSwap(ctx, gross, 0n, delivered);
            await setGbPreviewFactor(groveBasinMock, 1_005n, 1_000n);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(delivered);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
            expect(await dsTokenMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });

        // Exact band edges: the cross-check reverts on `gbPreview < minBand` / `gbPreview > maxBand`,
        // so a quote landing *exactly* on either edge must still be accepted and delivered. With
        // parity decimals the internal NAV quote equals `net`, so previewFactor (DENOM ∓ tol)/DENOM
        // places the Grove Basin quote precisely on minBand/maxBand.
        it('delivers at exactly the lower band edge (gbPreview == minBand)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const net = gross;
            const edgeNumerator = TOLERANCE_DENOMINATOR - DEFAULT_RATE_TOLERANCE; // 99_000 (-1%)
            const delivered = (net * edgeNumerator) / TOLERANCE_DENOMINATOR; // == minBand (floor)
            await prepareSwap(ctx, gross, 0n, delivered);
            await setGbPreviewFactor(groveBasinMock, edgeNumerator, TOLERANCE_DENOMINATOR);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(delivered);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
            expect(await dsTokenMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });

        it('delivers at exactly the upper band edge (gbPreview == maxBand)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, dsTokenMock, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const net = gross;
            const edgeNumerator = TOLERANCE_DENOMINATOR + DEFAULT_RATE_TOLERANCE; // 101_000 (+1%)
            const delivered = (net * edgeNumerator) / TOLERANCE_DENOMINATOR; // == maxBand (floor)
            await prepareSwap(ctx, gross, 0n, delivered);
            await setGbPreviewFactor(groveBasinMock, edgeNumerator, TOLERANCE_DENOMINATOR);

            await onRamp.connect(investor).swap(gross, MIN_OUT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(delivered);
            expect(await dsTokenMock.balanceOf(await onRamp.getAddress())).to.equal(0n);
            expect(await dsTokenMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
            expect(await usdcMock.balanceOf(await groveBasinMock.getAddress())).to.equal(net);
            expect(await usdcMock.balanceOf(await assetProvider.getAddress())).to.equal(0n);
        });
    });

    describe('NAV cross-check (rate band) & execution floor', function () {
        it('reverts above the band when Grove Basin overprices the asset (MaxRateDivergenceError)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            // previewFactor 2/1 => Grove Basin quote is 2x the NAV, far above the 1% band.
            await setGbPreviewFactor(groveBasinMock, 2n, 1n);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'MaxRateDivergenceError',
            );
        });

        it('reverts below the band when Grove Basin underprices the asset (MinRateDivergenceError)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            // previewFactor 1/2 => Grove Basin quote is half the NAV, far below the 1% band.
            await setGbPreviewFactor(groveBasinMock, 1n, 2n);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'MinRateDivergenceError',
            );
        });

        // Tight boundary complement to the exact-edge delivery tests: one unit past the edge reverts.
        // With parity decimals the internal NAV quote equals `net`, so minBand == net*(DENOM-tol)/DENOM.
        // Quoting exactly minBand - 1 must fall out of the band.
        it('reverts one unit below the lower band edge (gbPreview == minBand - 1)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const net = gross;
            await prepareSwap(ctx, gross, 0n);
            const minBand = (net * (TOLERANCE_DENOMINATOR - DEFAULT_RATE_TOLERANCE)) / TOLERANCE_DENOMINATOR;
            // previewFactor (minBand - 1)/net => gbPreview == minBand - 1, just outside the band.
            await setGbPreviewFactor(groveBasinMock, minBand - 1n, net);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'MinRateDivergenceError',
            );
        });

        it('reverts one unit above the upper band edge (gbPreview == maxBand + 1)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const net = gross;
            await prepareSwap(ctx, gross, 0n);
            const maxBand = (net * (TOLERANCE_DENOMINATOR + DEFAULT_RATE_TOLERANCE)) / TOLERANCE_DENOMINATOR;
            // previewFactor (maxBand + 1)/net => gbPreview == maxBand + 1, just outside the band.
            await setGbPreviewFactor(groveBasinMock, maxBand + 1n, net);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'MaxRateDivergenceError',
            );
        });

        it('reverts when execution slips below the quoted floor (AmountOutTooLow)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            // Preview matches the quote (passes binding & band) but execution delivers 99% of it, so
            // Grove Basin's native minAmountOut floor (== the quoted amount) reverts the swap.
            await groveBasinMock.setOutputFactor(99n, 100n);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                groveBasinMock,
                'AmountOutTooLow',
            );
        });
    });

    describe('Swap liquidity & guards', function () {
        it('reverts when Grove Basin lacks asset (InsufficientAssetLiquidity)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n, 0n); // fund no asset
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT))
                .revertedWithCustomError(assetProvider, 'InsufficientAssetLiquidity')
                .withArgs(expected, 0n);
        });

        it('reverts on slippage when minOut exceeds the NAV quote', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);
            await expect(onRamp.connect(investor).swap(gross, expected + 1n)).revertedWithCustomError(
                onRamp,
                'SlippageControlError',
            );
        });

        it('reverts when the NAV rate is zero', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, investor, zeroRateNavProviderMock } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            await onRamp.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                onRamp,
                'NonZeroNavRateError',
            );
        });

        it('reverts when the provider is paused', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, investor } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            await assetProvider.pause();
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'EnforcedPause',
            );
        });
    });

    describe('supplyExactIn direct access', function () {
        it('reverts for non on-ramp callers', async function () {
            const { assetProvider, stranger, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(
                assetProvider.connect(stranger).supplyExactIn(investor.address, 1n, 1n),
            ).revertedWithCustomError(assetProvider, 'UnauthorizedAccount');
        });

        it('reverts with ZeroAmountToSwap when the net liquidity is zero', async function () {
            const { onRamp, assetProvider, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            await expect(
                assetProvider.connect(onRampSigner).supplyExactIn(investor.address, 0n, 0n),
            ).revertedWithCustomError(assetProvider, 'ZeroAmountToSwap');
        });

        it('reverts with InsufficientLiquidityToSwap when the provider holds less than the net', async function () {
            const { onRamp, assetProvider, usdcMock, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            await usdcMock.mint(await assetProvider.getAddress(), 500_000n);
            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            await expect(assetProvider.connect(onRampSigner).supplyExactIn(investor.address, 1_000_000n, 1_000_000n))
                .revertedWithCustomError(assetProvider, 'InsufficientLiquidityToSwap')
                .withArgs(1_000_000n, 500_000n);
        });

        it('reverts with NonZeroNavRateError when the NAV rate is zero', async function () {
            const { onRamp, assetProvider, usdcMock, navProviderMock, investor } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );
            // Fund the provider directly and drive supplyExactIn as the on-ramp with a zero NAV rate so
            // the provider's NAV cross-check (_assetForLiquidity) hits its guard. The expected amount
            // must match the Grove Basin quote for the net (1:1 parity) so the binding passes first and
            // execution reaches the NAV band.
            await usdcMock.mint(await assetProvider.getAddress(), 1_000_000n);
            await navProviderMock.setRate(0);

            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            await expect(
                assetProvider.connect(onRampSigner).supplyExactIn(investor.address, 1_000_000n, 1_000_000n),
            ).revertedWithCustomError(assetProvider, 'NonZeroNavRateError');
        });

        it('reverts with UnexpectedSwapOutputError on an inconsistent expected amount', async function () {
            const { onRamp, assetProvider, usdcMock, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            await usdcMock.mint(await assetProvider.getAddress(), 1_000_000n);
            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            // net = 1e6 → Grove 1:1 preview = 1e6; passing a mismatched expected reverts before the swap.
            await expect(assetProvider.connect(onRampSigner).supplyExactIn(investor.address, 1_000_000n, 1_000_001n))
                .revertedWithCustomError(assetProvider, 'UnexpectedSwapOutputError')
                .withArgs(1_000_001n, 1_000_000n);
        });

        it('disables the legacy balance-based supplyTo entrypoint', async function () {
            const { assetProvider, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(assetProvider.supplyTo(investor.address, 1n)).revertedWithCustomError(
                assetProvider,
                'DirectSupplyNotSupported',
            );
        });
    });
});
