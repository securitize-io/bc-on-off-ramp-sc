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
    DEFAULT_REDEEM_TOLERANCE,
    FEE_COLLECTOR,
} from './external-asset-provider.fixture';

const MIN_OUT = 0n;

describe('On-Ramp External Asset Provider (swapExactIn, strict 1:1)', function () {
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
            expect(await assetProvider.redeemTolerance()).to.equal(DEFAULT_REDEEM_TOLERANCE);
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

        // initialize() validates the Grove Basin wiring via _validateGroveBasinConfig
        // (initialize -> __BaseExternalGroveBasinProvider_init -> _setExternalProvider).
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

        it('setReferralCode and setRedeemTolerance validations and events', async function () {
            const { assetProvider, stranger } = await loadFixture(deployOnRampExternalAssetProvider);

            await expect(assetProvider.connect(stranger).setReferralCode(7)).revertedWithCustomError(
                assetProvider,
                'AccessControlUnauthorizedAccount',
            );
            await expect(assetProvider.setReferralCode(7)).to.emit(assetProvider, 'ReferralCodeUpdated').withArgs(0, 7);

            await expect(assetProvider.setRedeemTolerance(TOLERANCE_DENOMINATOR + 1n))
                .revertedWithCustomError(assetProvider, 'InvalidRedeemToleranceError')
                .withArgs(TOLERANCE_DENOMINATOR + 1n);
            await expect(assetProvider.setRedeemTolerance(2_000n))
                .to.emit(assetProvider, 'RedeemToleranceUpdated')
                .withArgs(DEFAULT_REDEEM_TOLERANCE, 2_000n);
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

    describe('Swap binding (anti-manipulation)', function () {
        it('reverts when liquidity is donated to the provider before the swap', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, usdcMock, investor, stranger } = ctx;

            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);

            await usdcMock.mint(stranger.address, 5n);
            await usdcMock.connect(stranger).transfer(await assetProvider.getAddress(), 5n);

            await expect(onRamp.connect(investor).swap(gross, MIN_OUT)).revertedWithCustomError(
                assetProvider,
                'UnexpectedLiquidityBalanceError',
            );
        });
    });

    describe('Strict 1:1 output protection', function () {
        it('reverts when Grove Basin would deliver more asset than expected (UnexpectedSwapOutputError)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);
            // previewFactor 2/1 => Grove Basin would deliver 2x the expected asset.
            await setGbPreviewFactor(groveBasinMock, 2n, 1n);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT))
                .revertedWithCustomError(assetProvider, 'UnexpectedSwapOutputError')
                .withArgs(expected, expected * 2n);
        });

        it('reverts when Grove Basin would deliver less asset than expected (UnexpectedSwapOutputError)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);
            // previewFactor 1/2 => Grove Basin would deliver half the expected asset.
            await setGbPreviewFactor(groveBasinMock, 1n, 2n);
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT))
                .revertedWithCustomError(assetProvider, 'UnexpectedSwapOutputError')
                .withArgs(expected, expected / 2n);
        });

        it('reverts on a sub-percent Grove Basin swap fee (UnexpectedSwapOutputError)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, assetProvider, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            const { expected } = await prepareSwap(ctx, gross, 0n);
            // A 0.1% Grove Basin fee makes the quote diverge from NAV by one fee step: strict 1:1
            // rejects it even though it is well within the inherited (unused) tolerance band.
            await groveBasinMock.setRedemptionFeeBps(10n);
            const fee = (expected * 10n + 9_999n) / 10_000n; // mirrors the mock's ceil rounding
            await expect(onRamp.connect(investor).swap(gross, MIN_OUT))
                .revertedWithCustomError(assetProvider, 'UnexpectedSwapOutputError')
                .withArgs(expected, expected - fee);
        });

        it('reverts when execution slips below the expected floor (AmountOutTooLow)', async function () {
            const ctx = await loadFixture(deployOnRampExternalAssetProvider);
            const { onRamp, groveBasinMock, investor } = ctx;
            const gross = 1_000_000_000n;
            await prepareSwap(ctx, gross, 0n);
            // Preview stays exactly 1:1 (passes the strict check) but execution delivers 99% of it,
            // so Grove Basin's native minAmountOut floor (== expected) reverts the swap.
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

    describe('supplyTo direct access', function () {
        it('reverts for non on-ramp callers', async function () {
            const { assetProvider, stranger, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            await expect(assetProvider.connect(stranger).supplyTo(investor.address, 1n)).revertedWithCustomError(
                assetProvider,
                'UnauthorizedAccount',
            );
        });

        it('reverts with ZeroAmountToSwap when the provider holds no liquidity', async function () {
            const { onRamp, assetProvider, investor } = await loadFixture(deployOnRampExternalAssetProvider);
            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            await expect(assetProvider.connect(onRampSigner).supplyTo(investor.address, 0n)).revertedWithCustomError(
                assetProvider,
                'ZeroAmountToSwap',
            );
        });

        it('reverts with NonZeroNavRateError when the NAV rate is zero', async function () {
            const { onRamp, assetProvider, usdcMock, navProviderMock, investor } = await loadFixture(
                deployOnRampExternalAssetProvider,
            );
            // Fund the provider directly and drive supplyTo as the on-ramp with a zero NAV rate so the
            // provider's internal NAV math hits its guard (the on-ramp modifier is bypassed here).
            await usdcMock.mint(await assetProvider.getAddress(), 1_000_000n);
            await navProviderMock.setRate(0);

            const onRampAddress = await onRamp.getAddress();
            await hre.network.provider.send('hardhat_setBalance', [onRampAddress, '0x56BC75E2D63100000']);
            const onRampSigner = await hre.ethers.getImpersonatedSigner(onRampAddress);
            await expect(assetProvider.connect(onRampSigner).supplyTo(investor.address, 1n)).revertedWithCustomError(
                assetProvider,
                'NonZeroNavRateError',
            );
        });
    });
});
