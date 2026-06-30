import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import {
    ASSET_AMOUNT,
    DEFAULT_RATE_TOLERANCE,
    FEE_COLLECTOR,
    MIN_OUTPUT_AMOUNT,
    RATE_DIVERGENCE_TOLERANCES,
    TOLERANCE_DENOMINATOR,
    investorId,
    deploySecuritizeGroveBasinProtocol,
    deploySecuritizeGroveBasinProtocolWithAssetBurn,
    deploySecuritizeGroveBasinProtocol6x18,
    deploySecuritizeGroveBasinProtocol18x6,
    deploySecuritizeGroveBasinProtocol2x6,
    deploySecuritizeGroveBasinProtocol1x6,
    deploySecuritizeGroveBasinProtocol0x6,
    deploySecuritizeGroveBasinProtocol12x6,
    expectedOutput,
    investorCountry,
    parityRate,
    prepareRedemption,
    rateBand,
    restrictedCountry,
    setGbPreviewFactor,
} from './securitize-grove-basin.fixture';

describe('Securitize Off-Ramp + Grove Basin Protocol', function () {
    // ─────────────────────────────────────────────────────────────────────────
    // SecuritizeOffRamp — Initialization
    // ─────────────────────────────────────────────────────────────────────────
    describe('SecuritizeOffRamp — Initialization', function () {
        it('should return a non-zero implementation address', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.getImplementationAddress()).to.not.equal(hre.ethers.ZeroAddress);
        });

        it('should have twoStepTransfer enabled after deploy', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            // The deploy task must call toggleTwoStepTransfer(true); without it the
            // single-step flow would bypass ExternalLiquidityProvider entirely.
            expect(await redemption.twoStepTransfer()).to.equal(true);
        });

        it('should not be paused', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.paused()).to.equal(false);
        });

        it('should have assetBurn disabled', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            // The deploy task forces assetBurn = false because the asset must be
            // transferred to ExternalLiquidityProvider before the Grove Basin swap.
            expect(await redemption.assetBurn()).to.equal(false);
        });

        it('should store the correct asset address', async function () {
            const { redemption, dsTokenMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.assetAddress()).to.equal(await dsTokenMock.getAddress());
        });

        it('should store the correct nav provider', async function () {
            const { redemption, navProviderMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.navProvider()).to.equal(await navProviderMock.getAddress());
        });

        it('should have the liquidity provider linked', async function () {
            const { redemption, liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.liquidityProvider()).to.equal(await liquidityProvider.getAddress());
        });

        it('should revert on re-initialization', async function () {
            const { redemption, dsTokenMock, navProviderMock, mockFeeManager } = await loadFixture(
                deploySecuritizeGroveBasinProtocol,
            );
            await expect(
                redemption.initialize(
                    await dsTokenMock.getAddress(),
                    await navProviderMock.getAddress(),
                    await mockFeeManager.getAddress(),
                    false,
                ),
            ).revertedWithCustomError(redemption, 'InvalidInitialization');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SecuritizeOffRamp — Access Control
    // ─────────────────────────────────────────────────────────────────────────
    describe('SecuritizeOffRamp — Access Control', function () {
        it('should revert updateLiquidityProvider for non-admin', async function () {
            const { redemption, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const r = redemption.connect(stranger);
            await expect(r.updateLiquidityProvider(stranger.address)).revertedWithCustomError(
                r,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert updateNavProvider for non-admin', async function () {
            const { redemption, stranger, navProviderMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const r = redemption.connect(stranger);
            await expect(r.updateNavProvider(await navProviderMock.getAddress())).revertedWithCustomError(
                r,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert updateNavProvider for zero address', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(redemption.updateNavProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                redemption,
                'NonZeroAddressError',
            );
        });

        it('should revert toggleTwoStepTransfer for non-admin', async function () {
            const { redemption, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const r = redemption.connect(stranger);
            await expect(r.toggleTwoStepTransfer(false)).revertedWithCustomError(r, 'AccessControlUnauthorizedAccount');
        });

        it('should revert pause for non-admin', async function () {
            const { redemption, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(redemption.connect(stranger).pause()).revertedWithCustomError(
                redemption,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert updateCountryRestriction for non-admin', async function () {
            const { redemption, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                redemption.connect(stranger).updateCountryRestriction(restrictedCountry, true),
            ).revertedWithCustomError(redemption, 'AccessControlUnauthorizedAccount');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SecuritizeOffRamp — calculateLiquidityTokenAmount
    // ─────────────────────────────────────────────────────────────────────────
    describe('SecuritizeOffRamp — calculateLiquidityTokenAmount', function () {
        it('should return the full 1:1 amount with zero fee (6x6)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            const amount = await ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);
            expect(amount).to.equal(ASSET_AMOUNT);
        });

        it('should deduct fee from the returned amount (6x6)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await ctx.mockFeeManager.setRedemptionFee(2000); // 2%
            await prepareRedemption(ctx, ASSET_AMOUNT);
            const amount = await ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);
            const FEE_DENOMINATOR = 100_000n;
            const fee = (ASSET_AMOUNT * 2000n + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
            expect(amount).to.equal(ASSET_AMOUNT - fee);
        });

        it('should return the correct decimal-adjusted amount (6x18)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol6x18);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            const amount = await ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);
            expect(amount).to.equal(expectedOutput(ASSET_AMOUNT, 6, 18));
        });

        it('should return the correct decimal-adjusted amount (18x6)', async function () {
            const ASSET_AMOUNT_18 = 10n ** 18n; // 1 unit at 18 decimals
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol18x6);
            await prepareRedemption(ctx, ASSET_AMOUNT_18);
            const amount = await ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT_18);
            expect(amount).to.equal(expectedOutput(ASSET_AMOUNT_18, 18, 6));
        });

        it('reflects the Grove Basin redemption fee and matches the delivered amount (6x6)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await groveBasinMock.setRedemptionFeeBps(10); // 0.1% Grove Basin fee, within the default 1% band
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const groveFee = (ASSET_AMOUNT * 10n + 9_999n) / 10_000n; // ceil, mirrors the mock (BPS = 10_000)
            const quoted = ASSET_AMOUNT - groveFee;

            // The quote now reflects the Grove Basin fee (no Securitize fee in this case)...
            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(quoted);

            // ...and the realized redemption delivers exactly that quoted amount.
            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(quoted);
        });

        it('composes the Grove Basin fee then the Securitize fee, matching the delivered amount (6x6)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, mockFeeManager, investor } = ctx;
            await groveBasinMock.setRedemptionFeeBps(10); // 0.1% Grove Basin fee
            await mockFeeManager.setRedemptionFee(2000); // 2% Securitize fee
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const FEE_DENOMINATOR = 100_000n;
            const groveFee = (ASSET_AMOUNT * 10n + 9_999n) / 10_000n;
            const afterGrove = ASSET_AMOUNT - groveFee;
            const securitizeFee = (afterGrove * 2000n + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR; // ceil
            const quoted = afterGrove - securitizeFee;

            // Quote applies the Grove Basin fee first, then the Securitize fee on the result.
            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(quoted);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(quoted);
            expect(await usdcMock.balanceOf(FEE_COLLECTOR)).to.equal(securitizeFee);
        });

        it('quotes from Grove Basin independently of the NAV rate (pre-fee NAV quote still guards)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await ctx.redemption.updateNavProvider(await ctx.zeroRateNavProviderMock.getAddress());

            // The Grove-based quote does not read the NAV rate, so a zero rate does not affect it.
            expect(await ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(ASSET_AMOUNT);

            // The NAV-based pre-fee quote (the tolerance-band anchor) still reverts on a zero rate.
            await expect(ctx.redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT)).revertedWithCustomError(
                ctx.redemption,
                'NonZeroNavRateError',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ExternalLiquidityProvider — Initialization
    // ─────────────────────────────────────────────────────────────────────────
    describe('ExternalLiquidityProvider — Initialization', function () {
        it('should return a non-zero implementation address', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.getImplementationAddress()).to.not.equal(hre.ethers.ZeroAddress);
        });

        it('should store the correct securitizeOffRamp address', async function () {
            const { liquidityProvider, redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.securitizeOffRamp()).to.equal(await redemption.getAddress());
        });

        it('should set recipient to itself', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            // recipient = address(this) is what enables the two-step transfer flow.
            expect(await liquidityProvider.recipient()).to.equal(await liquidityProvider.getAddress());
        });

        it('should derive the asset token from the off-ramp', async function () {
            const { liquidityProvider, dsTokenMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.assetToken()).to.equal(await dsTokenMock.getAddress());
        });

        it('should store the correct liquidity token', async function () {
            const { liquidityProvider, usdcMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.liquidityToken()).to.equal(await usdcMock.getAddress());
        });

        it('should store the correct Grove Basin address', async function () {
            const { liquidityProvider, groveBasinMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.externalProvider()).to.equal(await groveBasinMock.getAddress());
        });

        it('should initialize rateTolerance to 1% (1000)', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.rateTolerance()).to.equal(DEFAULT_RATE_TOLERANCE);
            expect(await liquidityProvider.DEFAULT_RATE_TOLERANCE()).to.equal(DEFAULT_RATE_TOLERANCE);
            expect(await liquidityProvider.TOLERANCE_DENOMINATOR()).to.equal(TOLERANCE_DENOMINATOR);
        });

        it('should revert on re-initialization', async function () {
            const { liquidityProvider, usdcMock, redemption, groveBasinMock } = await loadFixture(
                deploySecuritizeGroveBasinProtocol,
            );
            await expect(
                liquidityProvider.initialize(
                    await usdcMock.getAddress(),
                    await redemption.getAddress(),
                    await groveBasinMock.getAddress(),
                ),
            ).revertedWithCustomError(liquidityProvider, 'InvalidInitialization');
        });

        // initialize() validates the Grove Basin wiring via _validateExternalProviderConfig
        // (initialize -> __BaseExternalProvider_init -> _setExternalProvider).
        describe('Grove Basin config validation at initialize', function () {
            const deployProxyWith = async (
                groveBasin: string,
                ctx: Awaited<ReturnType<typeof deploySecuritizeGroveBasinProtocol>>,
            ) => {
                const Factory = await hre.ethers.getContractFactory('ExternalLiquidityProvider');
                const promise = hre.upgrades.deployProxy(
                    Factory,
                    [await ctx.usdcMock.getAddress(), await ctx.redemption.getAddress(), groveBasin],
                    { kind: 'uups' },
                );
                return { Factory, promise };
            };

            it('reverts when the Grove Basin address is not a contract', async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                const { Factory, promise } = await deployProxyWith(ctx.stranger.address, ctx);
                await expect(promise).revertedWithCustomError(Factory, 'NotAContract');
            });

            it('reverts when collateralToken does not match the liquidity token', async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                // collateralToken = DSToken (not USDC)
                const wrongBasin = await hre.ethers.deployContract('MockGroveBasin', [
                    await ctx.dsTokenMock.getAddress(),
                ]);
                await wrongBasin.setCreditToken(await ctx.dsTokenMock.getAddress());
                const { Factory, promise } = await deployProxyWith(await wrongBasin.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'CollateralTokenMismatch');
            });

            it('reverts when creditToken does not match the asset', async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                // collateralToken = USDC (ok) but creditToken = USDC (not the asset)
                const wrongBasin = await hre.ethers.deployContract('MockGroveBasin', [await ctx.usdcMock.getAddress()]);
                await wrongBasin.setCreditToken(await ctx.usdcMock.getAddress());
                const { Factory, promise } = await deployProxyWith(await wrongBasin.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'CreditTokenMismatch');
            });

            it('reverts when the Grove Basin pocket is the zero address', async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                const zeroPocket = await hre.ethers.deployContract('MockGroveBasinZeroPocket', [
                    await ctx.usdcMock.getAddress(),
                    await ctx.dsTokenMock.getAddress(),
                ]);
                const { Factory, promise } = await deployProxyWith(await zeroPocket.getAddress(), ctx);
                await expect(promise).revertedWithCustomError(Factory, 'PocketZeroAddressError');
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ExternalLiquidityProvider — Access Control
    // ─────────────────────────────────────────────────────────────────────────
    describe('ExternalLiquidityProvider — Access Control', function () {
        it('should revert supplyTo when caller is not the off-ramp', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).supplyTo(stranger.address, ASSET_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'RedemptionUnauthorizedAccount');
        });

        it('should revert setExternalProvider for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).setExternalProvider(stranger.address),
            ).revertedWithCustomError(liquidityProvider, 'AccessControlUnauthorizedAccount');
        });

        it('should revert setExternalProvider for zero address', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.setExternalProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                liquidityProvider,
                'NonZeroAddressError',
            );
        });

        it('should revert setReferralCode for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.connect(stranger).setReferralCode(42)).revertedWithCustomError(
                liquidityProvider,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert pause for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.connect(stranger).pause()).revertedWithCustomError(
                liquidityProvider,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert redeem when off-ramp twoStepTransfer is disabled', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.toggleTwoStepTransfer(false);
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                liquidityProvider,
                'TwoStepTransferRequired',
            );
        });

        it('should revert redeem in single-step mode when fees are active', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, investor, mockFeeManager } = ctx;
            await mockFeeManager.setRedemptionFee(2000);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.toggleTwoStepTransfer(false);
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                liquidityProvider,
                'TwoStepTransferRequired',
            );
        });

        it('should revert supplyTo when the linked off-ramp has assetBurn enabled', async function () {
            const { redemption, liquidityProvider } = await loadFixture(
                deploySecuritizeGroveBasinProtocolWithAssetBurn,
            );
            const redemptionAddress = await redemption.getAddress();
            expect(await redemption.assetBurn()).to.equal(true);

            await hre.network.provider.send('hardhat_impersonateAccount', [redemptionAddress]);
            await hre.network.provider.send('hardhat_setBalance', [redemptionAddress, '0x1000000000000000000']);
            const redemptionSigner = await hre.ethers.getSigner(redemptionAddress);

            await expect(
                liquidityProvider.connect(redemptionSigner).supplyTo(redemptionAddress, ASSET_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'AssetBurnNotSupported');
        });

        it('should revert redeem when the linked off-ramp has assetBurn enabled', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocolWithAssetBurn);
            const { redemption, liquidityProvider, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                liquidityProvider,
                'AssetBurnNotSupported',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ExternalLiquidityProvider — availableLiquidity
    // ─────────────────────────────────────────────────────────────────────────
    describe('ExternalLiquidityProvider — availableLiquidity', function () {
        it('should return 0 when Grove Basin has no USDC', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.availableLiquidity()).to.equal(0n);
        });

        it('should return the USDC balance custodied by the Grove Basin contract', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, groveBasinMock } = ctx;
            const fundAmount = 5_000_000n;
            await usdcMock.mint(await groveBasinMock.getAddress(), fundAmount);
            expect(await liquidityProvider.availableLiquidity()).to.equal(fundAmount);
        });

        it('should ignore an external pocket for the collateral token and track the Grove Basin balance', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, groveBasinMock, stranger } = ctx;
            const basinAmount = 3_000_000n;
            const pocketAmount = 9_000_000n;
            // The pocket only custodies the swap token; collateral liquidity stays in the basin.
            await groveBasinMock.setPocket(stranger.address);
            await usdcMock.mint(await groveBasinMock.getAddress(), basinAmount);
            await usdcMock.mint(stranger.address, pocketAmount);
            expect(await liquidityProvider.availableLiquidity()).to.equal(basinAmount);
        });

        it('should read the pocket balance when the liquidity token is the Grove Basin swap token', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, groveBasinMock, stranger } = ctx;
            const pocketAmount = 4_000_000n;
            // Wire USDC as the swap token so custody resolves to the pocket.
            await groveBasinMock.setSwapToken(await usdcMock.getAddress());
            await groveBasinMock.setPocket(stranger.address);
            await usdcMock.mint(stranger.address, pocketAmount);
            expect(await liquidityProvider.availableLiquidity()).to.equal(pocketAmount);
        });

        it('should revert getLiquidityCustodian when pocket is the zero address', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, dsTokenMock, usdcMock } = ctx;
            const MockGroveBasinZeroPocket = await hre.ethers.getContractFactory('MockGroveBasinZeroPocket');
            const zeroPocketBasin = await MockGroveBasinZeroPocket.deploy(
                await usdcMock.getAddress(),
                await dsTokenMock.getAddress(),
            );
            await expect(
                liquidityProvider.setExternalProvider(await zeroPocketBasin.getAddress()),
            ).revertedWithCustomError(liquidityProvider, 'PocketZeroAddressError');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ExternalLiquidityProvider — Grove Basin validation
    // ─────────────────────────────────────────────────────────────────────────
    describe('ExternalLiquidityProvider — Grove Basin validation', function () {
        it('should revert setExternalProvider for a non-contract address', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.setExternalProvider(stranger.address)).revertedWithCustomError(
                liquidityProvider,
                'NotAContract',
            );
        });

        it('should revert setExternalProvider when collateralToken does not match liquidityToken', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, dsTokenMock } = ctx;
            const wrongCollateralBasin = await hre.ethers.deployContract('MockGroveBasin', [
                await usdcMock.getAddress(),
            ]);
            await wrongCollateralBasin.setCreditToken(await dsTokenMock.getAddress());
            await wrongCollateralBasin.setCollateralToken(await dsTokenMock.getAddress());
            await expect(liquidityProvider.setExternalProvider(await wrongCollateralBasin.getAddress()))
                .revertedWithCustomError(liquidityProvider, 'CollateralTokenMismatch')
                .withArgs(await usdcMock.getAddress(), await dsTokenMock.getAddress());
        });

        it('should revert setExternalProvider when creditToken does not match assetToken', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, stranger } = ctx;
            const wrongCreditBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await wrongCreditBasin.setCreditToken(stranger.address);
            await expect(liquidityProvider.setExternalProvider(await wrongCreditBasin.getAddress()))
                .revertedWithCustomError(liquidityProvider, 'CreditTokenMismatch')
                .withArgs(await ctx.dsTokenMock.getAddress(), stranger.address);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Redeem — success paths
    // ─────────────────────────────────────────────────────────────────────────
    describe('Redeem — success paths', function () {
        it('should complete the full redemption flow (6x6 decimals, zero fee)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, dsTokenMock, usdcMock, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(0n);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);
        });

        it('should complete the full redemption flow (6x18 decimals, zero fee)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol6x18);
            const { redemption, dsTokenMock, usdcMock, investor } = ctx;
            const { preFeeExpected } = await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(0n);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(preFeeExpected);
        });

        it('should complete the full redemption flow (18x6 decimals, zero fee)', async function () {
            const ASSET_AMOUNT_18 = 10n ** 18n;
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol18x6);
            const { redemption, dsTokenMock, usdcMock, investor } = ctx;
            const { preFeeExpected } = await prepareRedemption(ctx, ASSET_AMOUNT_18);

            await redemption.connect(investor).redeem(ASSET_AMOUNT_18, MIN_OUTPUT_AMOUNT);

            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(0n);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(preFeeExpected);
        });

        it('should deduct fee and send it to feeCollector', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, investor, mockFeeManager } = ctx;
            await mockFeeManager.setRedemptionFee(2000); // 2%
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            const FEE_DENOMINATOR = 100_000n;
            const fee = (ASSET_AMOUNT * 2000n + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT - fee);
            expect(await usdcMock.balanceOf(FEE_COLLECTOR)).to.equal(fee);
        });

        it('should route the asset to Grove Basin via the two-step flow (not burn)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, dsTokenMock, groveBasinMock, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            // Asset arrives at Grove Basin — proves the two-step flow ran and assetBurn = false.
            expect(await dsTokenMock.balanceOf(await groveBasinMock.getAddress())).to.equal(ASSET_AMOUNT);
        });

        it('should emit RedemptionCompleted with correct values', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, navProviderMock, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const rate = await navProviderMock.rate();

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .to.emit(redemption, 'RedemptionCompleted')
                .withArgs(investor.address, ASSET_AMOUNT, ASSET_AMOUNT, rate, 0n, await usdcMock.getAddress());
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Redeem — accounting binding (BC-2207, BugPocer TP: full-balance sweep)
    //
    // supplyTo must swap only the asset delivered by the CURRENT redemption, never any
    // pre-existing/stuck asset already sitting on the provider. The binding is enforced by
    // comparing the NAV gross the off-ramp expects with the NAV gross derived from the
    // provider's on-hand balance; a mismatch reverts with {UnexpectedAssetBalanceError}.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Redeem — accounting binding', function () {
        it('should settle a clean redemption and leave no asset on the provider', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, dsTokenMock, liquidityProvider, investor } = ctx;
            const { preFeeExpected } = await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            // Investor receives exactly the amount for what they redeemed (1:1, zero fee).
            expect(await usdcMock.balanceOf(investor.address)).to.equal(preFeeExpected);
            // The provider does not retain asset beyond the single redemption.
            expect(await dsTokenMock.balanceOf(await liquidityProvider.getAddress())).to.equal(0n);
        });

        it('should revert without sweeping pre-existing/stuck asset on the provider', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, dsTokenMock, liquidityProvider, investor } = ctx;
            const STUCK_ASSET_AMOUNT = 5_000_000n; // 5 units sitting on the provider before the redemption

            await prepareRedemption(ctx, ASSET_AMOUNT);
            const providerAddress = await liquidityProvider.getAddress();
            await dsTokenMock.mint(providerAddress, STUCK_ASSET_AMOUNT);

            // The off-ramp expects the NAV gross for ASSET_AMOUNT, but the on-hand balance during
            // supplyTo would be ASSET_AMOUNT + STUCK_ASSET_AMOUNT.
            const expectedNavGross = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);
            const actualNavGross = await redemption.calculateLiquidityTokenAmountBeforeFee(
                ASSET_AMOUNT + STUCK_ASSET_AMOUNT,
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(liquidityProvider, 'UnexpectedAssetBalanceError')
                .withArgs(expectedNavGross, actualNavGross);

            // Atomic revert: investor keeps their asset, receives no liquidity, and the stuck
            // balance is untouched (not converted and handed to the redeemer).
            expect(await usdcMock.balanceOf(investor.address)).to.equal(0n);
            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);
            expect(await dsTokenMock.balanceOf(providerAddress)).to.equal(STUCK_ASSET_AMOUNT);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Redeem — failure paths
    // ─────────────────────────────────────────────────────────────────────────
    describe('Redeem — failure paths', function () {
        it('should revert when the contract is paused', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.pause();
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                redemption,
                'EnforcedPause',
            );
        });

        it('should revert when NAV rate is zero', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor, zeroRateNavProviderMock } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                redemption,
                'NonZeroNavRateError',
            );
        });

        it('should revert with SlippageControlError when output is below minOutputAmount', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            // Demand more than the 1:1 output to trigger slippage guard.
            const impossibleMin = ASSET_AMOUNT + 1n;
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, impossibleMin)).revertedWithCustomError(
                redemption,
                'SlippageControlError',
            );
        });

        it('should revert with InsufficientLiquidity when Grove Basin lacks funds', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, dsTokenMock, investor } = ctx;
            // Mint asset and approve but do NOT fund Grove Basin.
            await dsTokenMock.mint(investor.address, ASSET_AMOUNT);
            await dsTokenMock.connect(investor).approve(await redemption.getAddress(), ASSET_AMOUNT);

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                ctx.liquidityProvider,
                'InsufficientLiquidity',
            );
        });

        it('should revert with InsufficientRedeemerBalance when investor lacks assets', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await usdcMock.mint(await groveBasinMock.getAddress(), ASSET_AMOUNT);
            // Approve without minting — balance will be 0.
            await ctx.dsTokenMock.connect(investor).approve(await redemption.getAddress(), ASSET_AMOUNT);

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                redemption,
                'InsufficientRedeemerBalance',
            );
        });

        it('should revert with RestrictedCountry for an investor in a restricted country', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, mockRegistryService, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.updateCountryRestriction(restrictedCountry, true);
            await mockRegistryService.updateInvestor(
                investorId,
                '0x',
                restrictedCountry,
                [investor.address],
                [],
                [],
                [],
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                redemption,
                'RestrictedCountry',
            );
        });

        it('should revert when the liquidity provider is paused', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await liquidityProvider.pause();
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                liquidityProvider,
                'EnforcedPause',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Admin operations
    // ─────────────────────────────────────────────────────────────────────────
    describe('Admin operations', function () {
        it('should update the nav provider', async function () {
            const { redemption, zeroRateNavProviderMock } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const newAddress = await zeroRateNavProviderMock.getAddress();
            await expect(redemption.updateNavProvider(newAddress))
                .to.emit(redemption, 'NavProviderUpdated')
                .withArgs(await redemption.navProvider(), newAddress);
            expect(await redemption.navProvider()).to.equal(newAddress);
        });

        it('should update the country restriction and emit an event', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(redemption.updateCountryRestriction(restrictedCountry, true))
                .to.emit(redemption, 'CountryRestrictionUpdated')
                .withArgs(restrictedCountry, true);
            expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(true);
        });

        it('should remove a country restriction', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await redemption.updateCountryRestriction(restrictedCountry, true);
            await redemption.updateCountryRestriction(restrictedCountry, false);
            expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(false);
        });

        it('should update Grove Basin address and emit ExternalProviderUpdated', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, dsTokenMock } = ctx;
            const newBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await newBasin.setCreditToken(await dsTokenMock.getAddress());
            const newAddress = await newBasin.getAddress();
            await expect(liquidityProvider.setExternalProvider(newAddress))
                .to.emit(liquidityProvider, 'ExternalProviderUpdated')
                .withArgs(await ctx.groveBasinMock.getAddress(), newAddress);
            expect(await liquidityProvider.externalProvider()).to.equal(newAddress);
        });

        it('should set the referral code and emit ReferralCodeUpdated', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const newCode = 99n;
            await expect(liquidityProvider.setReferralCode(newCode))
                .to.emit(liquidityProvider, 'ReferralCodeUpdated')
                .withArgs(0n, newCode);
            expect(await liquidityProvider.referralCode()).to.equal(newCode);
        });

        it('should pause and unpause the off-ramp', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await redemption.pause();
            expect(await redemption.paused()).to.equal(true);
            await redemption.unpause();
            expect(await redemption.paused()).to.equal(false);
        });

        it('should pause and unpause the liquidity provider', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await liquidityProvider.pause();
            expect(await liquidityProvider.paused()).to.equal(true);
            await liquidityProvider.unpause();
            expect(await liquidityProvider.paused()).to.equal(false);
        });

        it('should allow a redemption after unpausing the off-ramp', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.pause();
            await redemption.unpause();

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Rate Divergence Protection
    // ─────────────────────────────────────────────────────────────────────────
    describe('Rate Divergence Protection', function () {
        it('should complete redemption when Grove Basin preview matches NAV within tolerance', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await groveBasinMock.setRedemptionFeeBps(10); // 0.1% GB fee — within default 1% band
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            const fee = (ASSET_AMOUNT * 10n + 9_999n) / 10_000n;
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT - fee);
        });

        it('should revert with MinRateDivergenceError when Grove Basin rate is too low', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
            await setGbPreviewFactor(groveBasinMock, 950n, 1_000n);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const navGross = ASSET_AMOUNT;
            const gbPreview = await groveBasinMock.previewSwapExactIn(
                await ctx.dsTokenMock.getAddress(),
                await ctx.usdcMock.getAddress(),
                ASSET_AMOUNT,
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(liquidityProvider, 'MinRateDivergenceError')
                .withArgs(navGross, gbPreview, DEFAULT_RATE_TOLERANCE);
        });

        it('should revert with MaxRateDivergenceError when Grove Basin rate is too high', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
            await setGbPreviewFactor(groveBasinMock, 1_050n, 1_000n);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const navGross = ASSET_AMOUNT;
            const gbPreview = await groveBasinMock.previewSwapExactIn(
                await ctx.dsTokenMock.getAddress(),
                await ctx.usdcMock.getAddress(),
                ASSET_AMOUNT,
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(liquidityProvider, 'MaxRateDivergenceError')
                .withArgs(navGross, gbPreview, DEFAULT_RATE_TOLERANCE);
        });

        it('should succeed with tolerance = 0 only when both oracle quotes match exactly', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, usdcMock, groveBasinMock, investor } = ctx;
            await liquidityProvider.setRateTolerance(0);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);

            await groveBasinMock.setRedemptionFeeBps(1);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                liquidityProvider,
                'MinRateDivergenceError',
            );
        });

        it('should revert with MaxRateDivergenceError at tolerance = 0 when Grove Basin overprices', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
            await liquidityProvider.setRateTolerance(0);
            await setGbPreviewFactor(groveBasinMock, 1_001n, 1_000n);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const navGross = ASSET_AMOUNT;
            const gbPreview = await groveBasinMock.previewSwapExactIn(
                await ctx.dsTokenMock.getAddress(),
                await ctx.usdcMock.getAddress(),
                ASSET_AMOUNT,
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(liquidityProvider, 'MaxRateDivergenceError')
                .withArgs(navGross, gbPreview, 0n);
        });

        it('should allow admin to set rateTolerance and emit RateToleranceUpdated', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const newTolerance = 5_500n;
            await expect(liquidityProvider.setRateTolerance(newTolerance))
                .to.emit(liquidityProvider, 'RateToleranceUpdated')
                .withArgs(DEFAULT_RATE_TOLERANCE, newTolerance);
            expect(await liquidityProvider.rateTolerance()).to.equal(newTolerance);
        });

        it('should revert setRateTolerance for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.connect(stranger).setRateTolerance(2_000n)).revertedWithCustomError(
                liquidityProvider,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('should revert setRateTolerance when tolerance exceeds denominator', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const invalidTolerance = TOLERANCE_DENOMINATOR + 1n;
            await expect(liquidityProvider.setRateTolerance(invalidTolerance))
                .revertedWithCustomError(liquidityProvider, 'InvalidRateToleranceError')
                .withArgs(invalidTolerance);
        });

        for (const { label, tolerance } of RATE_DIVERGENCE_TOLERANCES) {
            describe(`tolerance ${label}`, function () {
                const setup = async () => {
                    const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                    if (tolerance !== DEFAULT_RATE_TOLERANCE) {
                        await ctx.liquidityProvider.setRateTolerance(tolerance);
                    }
                    return ctx;
                };

                it('should succeed at the exact lower band boundary', async function () {
                    const ctx = await setup();
                    const { redemption, usdcMock, groveBasinMock, investor } = ctx;
                    const navGross = ASSET_AMOUNT;
                    const { min } = rateBand(navGross, tolerance);
                    await setGbPreviewFactor(groveBasinMock, TOLERANCE_DENOMINATOR - tolerance, TOLERANCE_DENOMINATOR);
                    await prepareRedemption(ctx, ASSET_AMOUNT, min);

                    await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
                    expect(await usdcMock.balanceOf(investor.address)).to.equal(min);
                });

                it('should succeed at the exact upper band boundary', async function () {
                    const ctx = await setup();
                    const { redemption, usdcMock, groveBasinMock, investor } = ctx;
                    const navGross = ASSET_AMOUNT;
                    const { max } = rateBand(navGross, tolerance);
                    await setGbPreviewFactor(groveBasinMock, TOLERANCE_DENOMINATOR + tolerance, TOLERANCE_DENOMINATOR);
                    await prepareRedemption(ctx, ASSET_AMOUNT, max);

                    await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
                    expect(await usdcMock.balanceOf(investor.address)).to.equal(max);
                });

                it('should revert one wei below the lower band boundary', async function () {
                    const ctx = await setup();
                    const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
                    const navGross = ASSET_AMOUNT;
                    const { min } = rateBand(navGross, tolerance);
                    await setGbPreviewFactor(groveBasinMock, min - 1n, navGross);
                    await prepareRedemption(ctx, ASSET_AMOUNT);

                    const gbPreview = await groveBasinMock.previewSwapExactIn(
                        await ctx.dsTokenMock.getAddress(),
                        await ctx.usdcMock.getAddress(),
                        ASSET_AMOUNT,
                    );

                    await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                        .revertedWithCustomError(liquidityProvider, 'MinRateDivergenceError')
                        .withArgs(navGross, gbPreview, tolerance);
                });

                it('should revert one wei above the upper band boundary', async function () {
                    const ctx = await setup();
                    const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
                    const navGross = ASSET_AMOUNT;
                    const { max } = rateBand(navGross, tolerance);
                    await setGbPreviewFactor(groveBasinMock, max + 1n, navGross);
                    await prepareRedemption(ctx, ASSET_AMOUNT);

                    const gbPreview = await groveBasinMock.previewSwapExactIn(
                        await ctx.dsTokenMock.getAddress(),
                        await ctx.usdcMock.getAddress(),
                        ASSET_AMOUNT,
                    );

                    await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                        .revertedWithCustomError(liquidityProvider, 'MaxRateDivergenceError')
                        .withArgs(navGross, gbPreview, tolerance);
                });

                it('should succeed with a 1:1 preview inside the band', async function () {
                    const ctx = await setup();
                    const { redemption, usdcMock, investor } = ctx;
                    await prepareRedemption(ctx, ASSET_AMOUNT);

                    await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
                    expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);
                });
            });
        }

        it('should apply rate divergence protection with decimal-adjusted quotes (6x18)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol6x18);
            const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
            const navGross = expectedOutput(ASSET_AMOUNT, 6, 18);
            await setGbPreviewFactor(groveBasinMock, 950n, 1_000n);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            const gbPreview = await groveBasinMock.previewSwapExactIn(
                await ctx.dsTokenMock.getAddress(),
                await ctx.usdcMock.getAddress(),
                ASSET_AMOUNT,
            );

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(liquidityProvider, 'MinRateDivergenceError')
                .withArgs(navGross, gbPreview, DEFAULT_RATE_TOLERANCE);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Decimal pairs — fee-aware quote (calculateEffectiveLiquidityTokenAmount) matches delivery
    //
    // Each pair redeems 10 units of the RWA, which is exactly 10 USDC (10_000_000 at 6 decimals)
    // pre-fee under parity NAV, so the expected quote/delivery is uniform across decimals. A 0.1%
    // Grove Basin fee (inside the default 1% band) exercises the fee-aware quote.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Asset decimals — fee-aware quote matches delivered amount', function () {
        const GB_FEE_BPS = 10n; // 0.1%, within the default 1% band
        const decimalCases = [
            { label: '2 dec RWA × 6 dec liquidity', fixture: deploySecuritizeGroveBasinProtocol2x6, assetDecimals: 2 },
            { label: '1 dec RWA × 6 dec liquidity', fixture: deploySecuritizeGroveBasinProtocol1x6, assetDecimals: 1 },
            { label: '0 dec RWA × 6 dec liquidity', fixture: deploySecuritizeGroveBasinProtocol0x6, assetDecimals: 0 },
            { label: '12 dec RWA × 6 dec liquidity', fixture: deploySecuritizeGroveBasinProtocol12x6, assetDecimals: 12 },
            { label: '18 dec RWA × 6 dec liquidity', fixture: deploySecuritizeGroveBasinProtocol18x6, assetDecimals: 18 },
        ];

        for (const c of decimalCases) {
            it(`quote reflects the Grove fee and equals the delivered amount (${c.label})`, async function () {
                const ctx = await loadFixture(c.fixture);
                const { redemption, usdcMock, groveBasinMock, investor } = ctx;
                const assetAmount = 10n * 10n ** BigInt(c.assetDecimals); // 10 units
                const navGross = expectedOutput(assetAmount, c.assetDecimals, 6); // 10_000_000 for every pair

                await groveBasinMock.setRedemptionFeeBps(GB_FEE_BPS);
                await prepareRedemption(ctx, assetAmount);

                const groveFee = (navGross * GB_FEE_BPS + 9_999n) / 10_000n; // ceil, mirrors the mock
                const quoted = navGross - groveFee;

                // Quote now subtracts the Grove Basin fee...
                expect(await redemption.calculateLiquidityTokenAmount(assetAmount)).to.equal(quoted);

                // ...and the realized redemption delivers exactly that amount.
                await redemption.connect(investor).redeem(assetAmount, MIN_OUTPUT_AMOUNT);
                expect(await usdcMock.balanceOf(investor.address)).to.equal(quoted);
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Grove Basin fee shifts reflected in the quote (6x6, quote only)
    //
    // calculateRedemptionFee can change abruptly; the quote must track it. Quote-only because a fee
    // beyond the tolerance band would (correctly) revert the redemption.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Grove Basin fee shifts reflected in the quote', function () {
        const feeCases = [0n, 10n, 100n, 1_000n, 5_000n]; // 0%, 0.1%, 1%, 10%, 50%
        for (const feeBps of feeCases) {
            it(`subtracts a ${Number(feeBps) / 100}% Grove fee from the quote`, async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                const { redemption, groveBasinMock } = ctx;
                await groveBasinMock.setRedemptionFeeBps(feeBps);
                await prepareRedemption(ctx, ASSET_AMOUNT);

                const groveFee = (ASSET_AMOUNT * feeBps + 9_999n) / 10_000n; // ceil
                expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(ASSET_AMOUNT - groveFee);
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Quote reflects Grove Basin rate drift (not just fee)
    //
    // The off-ramp quotes calculateLiquidityTokenAmount from previewSwapExactIn, so a Grove Basin
    // oracle that prices the asset off the Securitize NAV (within the band) is shown in the quote and
    // matches what the redemption delivers — something a NAV-only quote (or a fee-only adjustment)
    // could not capture.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Quote reflects Grove Basin rate drift (not just fee)', function () {
        it('reflects a +0.5% Grove drift in the quote and matches delivery', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await setGbPreviewFactor(groveBasinMock, 1_005n, 1_000n); // +0.5%, inside the default 1% band
            await prepareRedemption(ctx, ASSET_AMOUNT, 20_000_000n); // fund for the higher output
            const expected = (ASSET_AMOUNT * 1_005n) / 1_000n; // 10,050,000 — NAV quote would say 10,000,000

            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(expected);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
        });

        it('reflects a -0.5% Grove drift in the quote and matches delivery', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await setGbPreviewFactor(groveBasinMock, 995n, 1_000n); // -0.5%
            await prepareRedemption(ctx, ASSET_AMOUNT);
            const expected = (ASSET_AMOUNT * 995n) / 1_000n; // 9,950,000

            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(expected);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
        });

        it('combines Grove drift and Grove fee in the quote (matches delivery)', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await groveBasinMock.setPreviewFactor(1_005n, 1_000n); // +0.5% drift
            await groveBasinMock.setRedemptionFeeBps(10n); // 0.1% Grove fee
            await groveBasinMock.setOutputFactor(1n, 1n);
            await prepareRedemption(ctx, ASSET_AMOUNT, 20_000_000n);

            const afterDrift = (ASSET_AMOUNT * 1_005n) / 1_000n; // 10,050,000
            const groveFee = (afterDrift * 10n + 9_999n) / 10_000n; // ceil
            const expected = afterDrift - groveFee;

            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(expected);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Extreme Grove Basin rate shifts (previewSwapExactIn) — 6x6
    //
    // Abrupt moves away from the 1:1 peg. Under the default 1% band every one reverts; the band is
    // the protection against a Grove Basin oracle that diverges sharply from the Securitize NAV.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Extreme Grove Basin rate shifts — default band reverts', function () {
        const rateScenarios = [
            { label: '2 RWA = 1 Liquidity (0.5x)', num: 1n, den: 2n, error: 'MinRateDivergenceError' },
            { label: '1 RWA = 2 Liquidity (2x)', num: 2n, den: 1n, error: 'MaxRateDivergenceError' },
            { label: '1 RWA = 4.3 Liquidity (4.3x)', num: 43n, den: 10n, error: 'MaxRateDivergenceError' },
            { label: '4.5 RWA = 1 Liquidity (~0.222x)', num: 2n, den: 9n, error: 'MinRateDivergenceError' },
        ];

        for (const s of rateScenarios) {
            it(`reverts under the default 1% band: ${s.label}`, async function () {
                const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                const { redemption, liquidityProvider, groveBasinMock, investor } = ctx;
                await setGbPreviewFactor(groveBasinMock, s.num, s.den);
                await prepareRedemption(ctx, ASSET_AMOUNT, 1_000_000_000n); // fund generously

                await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    s.error,
                );
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Extreme Grove Basin rate shifts with 100% tolerance — full trust, no band
    //
    // Full trust (rateTolerance == 100%) skips the NAV divergence check entirely: the redeemer
    // always receives the realized Grove Basin output, with no upper or lower cap. Even a 4.3x
    // quote — well beyond any band — is delivered.
    // ─────────────────────────────────────────────────────────────────────────
    describe('Extreme Grove Basin rate shifts — 100% tolerance', function () {
        const setup = async (num: bigint, den: bigint) => {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await ctx.liquidityProvider.setRateTolerance(TOLERANCE_DENOMINATOR); // 100%
            await setGbPreviewFactor(ctx.groveBasinMock, num, den);
            await prepareRedemption(ctx, ASSET_AMOUNT, 1_000_000_000n);
            return ctx;
        };

        const deliverableCases = [
            { label: '1 RWA = 1 Liquidity', num: 1n, den: 1n, delivered: 10_000_000n },
            { label: '2 RWA = 1 Liquidity (0.5x)', num: 1n, den: 2n, delivered: 5_000_000n },
            { label: '1 RWA = 2 Liquidity (2x)', num: 2n, den: 1n, delivered: 20_000_000n },
            { label: '4.5 RWA = 1 Liquidity (~0.222x)', num: 2n, den: 9n, delivered: 2_222_222n },
            { label: '1 RWA = 4.3 Liquidity (4.3x, beyond any band)', num: 43n, den: 10n, delivered: 43_000_000n },
        ];

        for (const c of deliverableCases) {
            it(`delivers the Grove Basin output: ${c.label}`, async function () {
                const ctx = await setup(c.num, c.den);
                const { redemption, usdcMock, investor } = ctx;
                await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
                expect(await usdcMock.balanceOf(investor.address)).to.equal(c.delivered);
            });
        }
    });
});
