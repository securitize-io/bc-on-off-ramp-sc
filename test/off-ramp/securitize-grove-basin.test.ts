import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import {
    ASSET_AMOUNT,
    DEFAULT_REDEEM_TOLERANCE,
    FEE_COLLECTOR,
    MIN_OUTPUT_AMOUNT,
    RATE_DIVERGENCE_TOLERANCES,
    TOLERANCE_DENOMINATOR,
    investorId,
    deploySecuritizeGroveBasinProtocol,
    deploySecuritizeGroveBasinProtocolWithAssetBurn,
    deploySecuritizeGroveBasinProtocol6x18,
    deploySecuritizeGroveBasinProtocol18x6,
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
            // single-step flow would bypass GroveBasinLiquidityProvider entirely.
            expect(await redemption.twoStepTransfer()).to.equal(true);
        });

        it('should not be paused', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await redemption.paused()).to.equal(false);
        });

        it('should have assetBurn disabled', async function () {
            const { redemption } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            // The deploy task forces assetBurn = false because the asset must be
            // transferred to GroveBasinLiquidityProvider before the Grove Basin swap.
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
            const { redemption, dsTokenMock, navProviderMock, mockFeeManager } =
                await loadFixture(deploySecuritizeGroveBasinProtocol);
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
            await expect(r.toggleTwoStepTransfer(false)).revertedWithCustomError(
                r,
                'AccessControlUnauthorizedAccount',
            );
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

        it('should revert when NAV rate is zero', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await ctx.redemption.updateNavProvider(await ctx.zeroRateNavProviderMock.getAddress());
            await expect(ctx.redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).revertedWithCustomError(
                ctx.redemption,
                'NonZeroNavRateError',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GroveBasinLiquidityProvider — Initialization
    // ─────────────────────────────────────────────────────────────────────────
    describe('GroveBasinLiquidityProvider — Initialization', function () {
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
            expect(await liquidityProvider.groveBasin()).to.equal(await groveBasinMock.getAddress());
        });

        it('should initialize redeemTolerance to 1% (1000)', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.redeemTolerance()).to.equal(DEFAULT_REDEEM_TOLERANCE);
            expect(await liquidityProvider.DEFAULT_REDEEM_TOLERANCE()).to.equal(DEFAULT_REDEEM_TOLERANCE);
            expect(await liquidityProvider.TOLERANCE_DENOMINATOR()).to.equal(TOLERANCE_DENOMINATOR);
        });

        it('should revert on re-initialization', async function () {
            const { liquidityProvider, usdcMock, redemption, groveBasinMock } =
                await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.initialize(
                    await usdcMock.getAddress(),
                    await redemption.getAddress(),
                    await groveBasinMock.getAddress(),
                ),
            ).revertedWithCustomError(liquidityProvider, 'InvalidInitialization');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GroveBasinLiquidityProvider — Access Control
    // ─────────────────────────────────────────────────────────────────────────
    describe('GroveBasinLiquidityProvider — Access Control', function () {
        it('should revert supplyTo when caller is not the off-ramp', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).supplyTo(stranger.address, ASSET_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'RedemptionUnauthorizedAccount');
        });

        it('should revert setGroveBasin for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).setGroveBasin(stranger.address),
            ).revertedWithCustomError(liquidityProvider, 'AccessControlUnauthorizedAccount');
        });

        it('should revert setGroveBasin for zero address', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.setGroveBasin(hre.ethers.ZeroAddress)).revertedWithCustomError(
                liquidityProvider,
                'NonZeroAddressError',
            );
        });

        it('should revert setReferralCode for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).setReferralCode(42),
            ).revertedWithCustomError(liquidityProvider, 'AccessControlUnauthorizedAccount');
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
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'TwoStepTransferRequired');
        });

        it('should revert redeem in single-step mode when fees are active', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, investor, mockFeeManager } = ctx;
            await mockFeeManager.setRedemptionFee(2000);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.toggleTwoStepTransfer(false);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'TwoStepTransferRequired');
        });

        it('should revert supplyTo when the linked off-ramp has assetBurn enabled', async function () {
            const { redemption, liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocolWithAssetBurn);
            const redemptionAddress = await redemption.getAddress();
            expect(await redemption.assetBurn()).to.equal(true);

            await hre.network.provider.send('hardhat_impersonateAccount', [redemptionAddress]);
            await hre.network.provider.send('hardhat_setBalance', [
                redemptionAddress,
                '0x1000000000000000000',
            ]);
            const redemptionSigner = await hre.ethers.getSigner(redemptionAddress);

            await expect(
                liquidityProvider.connect(redemptionSigner).supplyTo(redemptionAddress, ASSET_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'AssetBurnNotSupported');
        });

        it('should revert redeem when the linked off-ramp has assetBurn enabled', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocolWithAssetBurn);
            const { redemption, liquidityProvider, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'AssetBurnNotSupported');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GroveBasinLiquidityProvider — availableLiquidity
    // ─────────────────────────────────────────────────────────────────────────
    describe('GroveBasinLiquidityProvider — availableLiquidity', function () {
        it('should return 0 when Grove Basin has no USDC', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            expect(await liquidityProvider.availableLiquidity()).to.equal(0n);
        });

        it('should return the USDC balance held in the Grove Basin pocket', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, groveBasinMock } = ctx;
            const fundAmount = 5_000_000n;
            await usdcMock.mint(await groveBasinMock.getAddress(), fundAmount);
            expect(await liquidityProvider.availableLiquidity()).to.equal(fundAmount);
        });

        it('should reflect an external pocket balance when one is configured', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, groveBasinMock, stranger } = ctx;
            const fundAmount = 3_000_000n;
            await groveBasinMock.setPocket(stranger.address);
            await usdcMock.mint(stranger.address, fundAmount);
            expect(await liquidityProvider.availableLiquidity()).to.equal(fundAmount);
        });

        it('should revert getLiquidityCustodian when pocket is the zero address', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, dsTokenMock, usdcMock } = ctx;
            const MockGroveBasinZeroPocket = await hre.ethers.getContractFactory('MockGroveBasinZeroPocket');
            const zeroPocketBasin = await MockGroveBasinZeroPocket.deploy(
                await usdcMock.getAddress(),
                await dsTokenMock.getAddress(),
            );
            await expect(liquidityProvider.setGroveBasin(await zeroPocketBasin.getAddress())).revertedWithCustomError(
                liquidityProvider,
                'PocketZeroAddressError',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GroveBasinLiquidityProvider — Grove Basin validation
    // ─────────────────────────────────────────────────────────────────────────
    describe('GroveBasinLiquidityProvider — Grove Basin validation', function () {
        it('should revert setGroveBasin for a non-contract address', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(liquidityProvider.setGroveBasin(stranger.address)).revertedWithCustomError(
                liquidityProvider,
                'NotAContract',
            );
        });

        it('should revert setGroveBasin when swapToken does not match liquidityToken', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, dsTokenMock } = ctx;
            const wrongSwapBasin = await hre.ethers.deployContract('MockGroveBasin', [await dsTokenMock.getAddress()]);
            await wrongSwapBasin.setCreditToken(await dsTokenMock.getAddress());
            await expect(liquidityProvider.setGroveBasin(await wrongSwapBasin.getAddress()))
                .revertedWithCustomError(liquidityProvider, 'SwapTokenMismatch')
                .withArgs(await ctx.usdcMock.getAddress(), await dsTokenMock.getAddress());
        });

        it('should revert setGroveBasin when creditToken does not match assetToken', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, stranger } = ctx;
            const wrongCreditBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await wrongCreditBasin.setCreditToken(stranger.address);
            await expect(liquidityProvider.setGroveBasin(await wrongCreditBasin.getAddress()))
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
    // Redeem — failure paths
    // ─────────────────────────────────────────────────────────────────────────
    describe('Redeem — failure paths', function () {
        it('should revert when the contract is paused', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.pause();
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'EnforcedPause');
        });

        it('should revert when NAV rate is zero', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor, zeroRateNavProviderMock } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'NonZeroNavRateError');
        });

        it('should revert with SlippageControlError when output is below minOutputAmount', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            // Demand more than the 1:1 output to trigger slippage guard.
            const impossibleMin = ASSET_AMOUNT + 1n;
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, impossibleMin),
            ).revertedWithCustomError(redemption, 'SlippageControlError');
        });

        it('should revert with InsufficientLiquidity when Grove Basin lacks funds', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, dsTokenMock, investor } = ctx;
            // Mint asset and approve but do NOT fund Grove Basin.
            await dsTokenMock.mint(investor.address, ASSET_AMOUNT);
            await dsTokenMock.connect(investor).approve(await redemption.getAddress(), ASSET_AMOUNT);

            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(ctx.liquidityProvider, 'InsufficientLiquidity');
        });

        it('should revert with InsufficientRedeemerBalance when investor lacks assets', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, usdcMock, groveBasinMock, investor } = ctx;
            await usdcMock.mint(await groveBasinMock.getAddress(), ASSET_AMOUNT);
            // Approve without minting — balance will be 0.
            await ctx.dsTokenMock.connect(investor).approve(await redemption.getAddress(), ASSET_AMOUNT);

            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'InsufficientRedeemerBalance');
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

            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'RestrictedCountry');
        });

        it('should revert when the liquidity provider is paused', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, investor } = ctx;
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await liquidityProvider.pause();
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'EnforcedPause');
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

        it('should update Grove Basin address and emit GroveBasinUpdated', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { liquidityProvider, usdcMock, dsTokenMock } = ctx;
            const newBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            await newBasin.setCreditToken(await dsTokenMock.getAddress());
            const newAddress = await newBasin.getAddress();
            await expect(liquidityProvider.setGroveBasin(newAddress))
                .to.emit(liquidityProvider, 'GroveBasinUpdated')
                .withArgs(await ctx.groveBasinMock.getAddress(), newAddress);
            expect(await liquidityProvider.groveBasin()).to.equal(newAddress);
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
                .withArgs(navGross, gbPreview, DEFAULT_REDEEM_TOLERANCE);
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
                .withArgs(navGross, gbPreview, DEFAULT_REDEEM_TOLERANCE);
        });

        it('should succeed with tolerance = 0 only when both oracle quotes match exactly', async function () {
            const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const { redemption, liquidityProvider, usdcMock, groveBasinMock, investor } = ctx;
            await liquidityProvider.setRedeemTolerance(0);
            await prepareRedemption(ctx, ASSET_AMOUNT);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(ASSET_AMOUNT);

            await groveBasinMock.setRedemptionFeeBps(1);
            await prepareRedemption(ctx, ASSET_AMOUNT);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'MinRateDivergenceError');
        });

        it('should allow admin to set redeemTolerance and emit RedeemToleranceUpdated', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const newTolerance = 5_500n;
            await expect(liquidityProvider.setRedeemTolerance(newTolerance))
                .to.emit(liquidityProvider, 'RedeemToleranceUpdated')
                .withArgs(DEFAULT_REDEEM_TOLERANCE, newTolerance);
            expect(await liquidityProvider.redeemTolerance()).to.equal(newTolerance);
        });

        it('should revert setRedeemTolerance for non-admin', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).setRedeemTolerance(2_000n),
            ).revertedWithCustomError(liquidityProvider, 'AccessControlUnauthorizedAccount');
        });

        it('should revert setRedeemTolerance when tolerance exceeds denominator', async function () {
            const { liquidityProvider } = await loadFixture(deploySecuritizeGroveBasinProtocol);
            const invalidTolerance = TOLERANCE_DENOMINATOR + 1n;
            await expect(liquidityProvider.setRedeemTolerance(invalidTolerance))
                .revertedWithCustomError(liquidityProvider, 'InvalidRedeemToleranceError')
                .withArgs(invalidTolerance);
        });

        for (const { label, tolerance } of RATE_DIVERGENCE_TOLERANCES) {
            describe(`tolerance ${label}`, function () {
                const setup = async () => {
                    const ctx = await loadFixture(deploySecuritizeGroveBasinProtocol);
                    if (tolerance !== DEFAULT_REDEEM_TOLERANCE) {
                        await ctx.liquidityProvider.setRedeemTolerance(tolerance);
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
                .withArgs(navGross, gbPreview, DEFAULT_REDEEM_TOLERANCE);
        });
    });
});
