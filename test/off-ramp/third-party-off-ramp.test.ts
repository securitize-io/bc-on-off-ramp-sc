import { expect } from 'chai';
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {
    ASSET_AMOUNT,
    deployGroveBasinProtocol,
    deployGroveBasinProtocol6x18,
    deployGroveBasinProtocol18x6,
    expectedOutput,
    investorId,
    MIN_OUTPUT_AMOUNT,
    parityRate,
    prepareRedemption,
    restrictedCountry,
    FEE_COLLECTOR,
} from './third-party-off-ramp.fixture';

describe('Grove Basin Off-Ramp Protocol Unit Tests', function () {
    describe('Off-Ramp Creation', function () {
        it('Should get implementation address correctly', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.getImplementationAddress()).to.exist.and.not.equal(hre.ethers.ZeroAddress);
        });

        it('Should get version correctly', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.getInitializedVersion()).to.equal(1);
        });

        it('Should set two-step transfer enabled on initialization', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.twoStepTransfer()).to.equal(true);
        });

        it('Should expose NAME and VERSION constants', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.NAME()).to.equal('ThirdPartyOffRamp');
            expect(await redemption.VERSION()).to.equal('1');
        });

        it('Should fail when trying to re-initialize', async function () {
            const { redemption, dsTokenMock, navProviderMock, mockFeeManager } =
                await loadFixture(deployGroveBasinProtocol);
            await expect(
                redemption.initialize(
                    await dsTokenMock.getAddress(),
                    await navProviderMock.getAddress(),
                    await mockFeeManager.getAddress(),
                    false,
                ),
            ).revertedWithCustomError(redemption, 'InvalidInitialization');
        });

        it('Should fail when initializing with a zero address NAV provider', async function () {
            const { dsTokenMock, mockFeeManager } = await loadFixture(deployGroveBasinProtocol);
            const OffRamp = await hre.ethers.getContractFactory('ThirdPartyOffRamp');
            await expect(
                hre.upgrades.deployProxy(OffRamp, [
                    await dsTokenMock.getAddress(),
                    hre.ethers.ZeroAddress,
                    await mockFeeManager.getAddress(),
                    false,
                ]),
            ).revertedWithCustomError(OffRamp, 'NonZeroAddressError');
        });

        it('Should fail when initializing with asset burn enabled', async function () {
            const { dsTokenMock, navProviderMock, mockFeeManager } = await loadFixture(deployGroveBasinProtocol);
            const OffRamp = await hre.ethers.getContractFactory('ThirdPartyOffRamp');
            await expect(
                hre.upgrades.deployProxy(OffRamp, [
                    await dsTokenMock.getAddress(),
                    await navProviderMock.getAddress(),
                    await mockFeeManager.getAddress(),
                    true,
                ]),
            ).revertedWithCustomError(OffRamp, 'AssetBurnNotSupportedError');
        });

        it('Should return asset and liquidity provider addresses', async function () {
            const { redemption, dsTokenMock, liquidityProvider } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.asset()).to.equal(await dsTokenMock.getAddress());
            expect(await redemption.liquidityProvider()).to.equal(await liquidityProvider.getAddress());
        });
    });

    describe('Liquidity Provider Creation', function () {
        it('Should get implementation address and version correctly', async function () {
            const { liquidityProvider } = await loadFixture(deployGroveBasinProtocol);
            expect(await liquidityProvider.getImplementationAddress()).to.exist.and.not.equal(
                hre.ethers.ZeroAddress,
            );
            expect(await liquidityProvider.getInitializedVersion()).to.equal(1);
        });

        it('Should set recipient to itself so the asset can be swapped', async function () {
            const { liquidityProvider } = await loadFixture(deployGroveBasinProtocol);
            expect(await liquidityProvider.recipient()).to.equal(await liquidityProvider.getAddress());
        });

        it('Should derive asset token from the off-ramp', async function () {
            const { liquidityProvider, dsTokenMock, usdcMock, groveBasinMock } =
                await loadFixture(deployGroveBasinProtocol);
            expect(await liquidityProvider.assetToken()).to.equal(await dsTokenMock.getAddress());
            expect(await liquidityProvider.liquidityToken()).to.equal(await usdcMock.getAddress());
            expect(await liquidityProvider.groveBasin()).to.equal(await groveBasinMock.getAddress());
        });

        it('Should fail when trying to re-initialize', async function () {
            const { liquidityProvider, usdcMock, redemption, groveBasinMock } =
                await loadFixture(deployGroveBasinProtocol);
            await expect(
                liquidityProvider.initialize(
                    await usdcMock.getAddress(),
                    await redemption.getAddress(),
                    await groveBasinMock.getAddress(),
                ),
            ).revertedWithCustomError(liquidityProvider, 'InvalidInitialization');
        });

        it('Should fail when initializing with a zero address', async function () {
            const { redemption, groveBasinMock } = await loadFixture(deployGroveBasinProtocol);
            const Provider = await hre.ethers.getContractFactory('GroveBasinLiquidityProvider'); // implementation name unchanged
            await expect(
                hre.upgrades.deployProxy(Provider, [
                    hre.ethers.ZeroAddress,
                    await redemption.getAddress(),
                    await groveBasinMock.getAddress(),
                ]),
            ).revertedWithCustomError(Provider, 'NonZeroAddressError');
        });
    });

    describe('Access Control', function () {
        it('Should grant OPERATOR_ROLE to the configured operator', async function () {
            const { redemption, operator } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.isOperator(operator.address)).to.equal(true);
        });

        it('Should allow any RWA token holder to call redeem directly', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx);
            // A holder with balance and allowance can redeem without any special role.
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).to.not.be.reverted;
        });

        it('Should fail to set Grove Basin from a non-admin wallet', async function () {
            const { liquidityProvider, stranger, groveBasinMock } = await loadFixture(deployGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).setGroveBasin(await groveBasinMock.getAddress()),
            ).revertedWithCustomError(liquidityProvider, 'AccessControlUnauthorizedAccount');
        });

        it('Should fail to set Grove Basin with a zero address', async function () {
            const { liquidityProvider } = await loadFixture(deployGroveBasinProtocol);
            await expect(liquidityProvider.setGroveBasin(hre.ethers.ZeroAddress)).revertedWithCustomError(
                liquidityProvider,
                'NonZeroAddressError',
            );
        });

        it('Should update Grove Basin and emit event', async function () {
            const { liquidityProvider, groveBasinMock, usdcMock } = await loadFixture(deployGroveBasinProtocol);
            const oldAddress = await groveBasinMock.getAddress();
            const newGroveBasin = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
            const newAddress = await newGroveBasin.getAddress();
            await expect(liquidityProvider.setGroveBasin(newAddress))
                .to.emit(liquidityProvider, 'GroveBasinUpdated')
                .withArgs(oldAddress, newAddress);
            expect(await liquidityProvider.groveBasin()).to.equal(newAddress);
        });

        it('Should update referral code and emit event', async function () {
            const { liquidityProvider } = await loadFixture(deployGroveBasinProtocol);
            await expect(liquidityProvider.setReferralCode(42))
                .to.emit(liquidityProvider, 'ReferralCodeUpdated')
                .withArgs(0, 42);
            expect(await liquidityProvider.referralCode()).to.equal(42);
        });

        it('Should fail to set referral code from a non-admin wallet', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deployGroveBasinProtocol);
            await expect(liquidityProvider.connect(stranger).setReferralCode(1)).revertedWithCustomError(
                liquidityProvider,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('Should fail when supplyTo is called by an account other than the off-ramp', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deployGroveBasinProtocol);
            await expect(
                liquidityProvider.connect(stranger).supplyTo(stranger.address, 1),
            ).revertedWithCustomError(liquidityProvider, 'RedemptionUnauthorizedAccount');
        });

        it('Should revert supplyTo when there is no asset balance to swap', async function () {
            const { liquidityProvider, redemption, stranger } = await loadFixture(deployGroveBasinProtocol);
            const offRampAddress = await redemption.getAddress();
            await setBalance(offRampAddress, hre.ethers.parseEther('1'));
            const offRampSigner = await hre.ethers.getImpersonatedSigner(offRampAddress);
            await expect(
                liquidityProvider.connect(offRampSigner).supplyTo(stranger.address, 1),
            ).revertedWithCustomError(liquidityProvider, 'ZeroAmountToSwap');
        });
    });

    describe('Pause / Unpause', function () {
        it('Should fail to redeem when off-ramp is paused', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx);
            await redemption.pause();
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'EnforcedPause');
        });

        it('Should fail to supply liquidity when provider is paused', async function () {
            const { liquidityProvider, stranger } = await loadFixture(deployGroveBasinProtocol);
            await liquidityProvider.pause();
            await expect(
                liquidityProvider.connect(stranger).supplyTo(stranger.address, 1),
            ).revertedWithCustomError(liquidityProvider, 'EnforcedPause');
        });

        it('Should fail to pause from a non-admin wallet', async function () {
            const { redemption, stranger } = await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.connect(stranger).pause()).revertedWithCustomError(
                redemption,
                'AccessControlUnauthorizedAccount',
            );
        });
    });

    describe('NAV Provider', function () {
        it('Should update the NAV provider and emit event', async function () {
            const { redemption, navProviderMock, zeroRateNavProviderMock } =
                await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress()))
                .to.emit(redemption, 'NavProviderUpdated')
                .withArgs(await navProviderMock.getAddress(), await zeroRateNavProviderMock.getAddress());
            expect(await redemption.navProvider()).to.equal(await zeroRateNavProviderMock.getAddress());
        });

        it('Should fail to update NAV provider with a zero address', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.updateNavProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                redemption,
                'NonZeroAddressError',
            );
        });

        it('Should fail to update NAV provider from a non-admin wallet', async function () {
            const { redemption, stranger, navProviderMock } = await loadFixture(deployGroveBasinProtocol);
            await expect(
                redemption.connect(stranger).updateNavProvider(await navProviderMock.getAddress()),
            ).revertedWithCustomError(redemption, 'AccessControlUnauthorizedAccount');
        });
    });

    describe('Quotes', function () {
        it('Should calculate liquidity token amount before and after fee with zero fee', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            expect(await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT)).to.equal(expected);
            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(expected);
        });

        it('Should subtract the fee from the calculated liquidity token amount', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, mockFeeManager, assetDecimals, liquidityDecimals } = ctx;
            await mockFeeManager.setRedemptionFee(500); // 0.5%
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            const fee = await mockFeeManager.getFee(expected);
            expect(await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).to.equal(expected - fee);
        });

        it('Should revert quotes when the NAV rate is zero', async function () {
            const { redemption, zeroRateNavProviderMock } = await loadFixture(deployGroveBasinProtocol);
            await redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT)).revertedWithCustomError(
                redemption,
                'NonZeroNavRateError',
            );
            await expect(redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT)).revertedWithCustomError(
                redemption,
                'NonZeroNavRateError',
            );
        });
    });

    describe('Available Liquidity', function () {
        it('Should report Grove Basin liquidity through provider and off-ramp', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, liquidityProvider, usdcMock, groveBasinMock } = ctx;
            await usdcMock.mint(await groveBasinMock.getAddress(), 1234n);
            expect(await liquidityProvider.availableLiquidity()).to.equal(1234n);
            expect(await redemption.availableLiquidity()).to.equal(1234n);
        });

        it('Should resolve the liquidity custodian to the Grove Basin pocket', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { liquidityProvider, groveBasinMock } = ctx;
            expect(await liquidityProvider.getLiquidityCustodian()).to.equal(await groveBasinMock.getAddress());

            const { stranger } = ctx;
            await groveBasinMock.setPocket(stranger.address);
            expect(await liquidityProvider.getLiquidityCustodian()).to.equal(stranger.address);
        });

        it('Should report the liquidity token balance held by the Grove Basin pocket', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, liquidityProvider, usdcMock, groveBasinMock, stranger } = ctx;
            // Fund the basin when pocket defaults to itself.
            await usdcMock.mint(await groveBasinMock.getAddress(), 1234n);
            // Point at an external pocket and fund it; availableLiquidity must follow the pocket.
            await groveBasinMock.setPocket(stranger.address);
            await usdcMock.mint(stranger.address, 5000n);
            expect(await liquidityProvider.availableLiquidity()).to.equal(5000n);
            expect(await redemption.availableLiquidity()).to.equal(5000n);
        });

        it('Should revert when the Grove Basin pocket is the zero address', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { liquidityProvider } = ctx;
            const zeroPocketBasin = await hre.ethers.deployContract('MockGroveBasinZeroPocket');
            await liquidityProvider.setGroveBasin(await zeroPocketBasin.getAddress());
            await expect(liquidityProvider.getLiquidityCustodian()).revertedWithCustomError(
                liquidityProvider,
                'PocketZeroAddressError',
            );
            await expect(liquidityProvider.availableLiquidity()).revertedWithCustomError(
                liquidityProvider,
                'PocketZeroAddressError',
            );
        });
    });

    describe('Redeem', function () {
        it('Should redeem instantly at 1:1 and deliver USDC to the investor', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, dsTokenMock, usdcMock, groveBasinMock, navProviderMock } = ctx;
            const { expected } = await prepareRedemption(ctx);

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .to.emit(redemption, 'RedemptionCompleted')
                .withArgs(
                    investor.address,
                    ASSET_AMOUNT,
                    expected,
                    await navProviderMock.rate(),
                    0,
                    await usdcMock.getAddress(),
                )
                .to.emit(redemption, 'GroveBasinRedemption')
                .withArgs(investor.address, ASSET_AMOUNT, expected, investor.address)
                .to.emit(groveBasinMock, 'Swap');

            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
            expect(await dsTokenMock.balanceOf(investor.address)).to.equal(0);
            // No funds left held by the off-ramp nor the provider
            expect(await usdcMock.balanceOf(await redemption.getAddress())).to.equal(0);
            expect(await usdcMock.balanceOf(await ctx.liquidityProvider.getAddress())).to.equal(0);
            expect(await dsTokenMock.balanceOf(await ctx.liquidityProvider.getAddress())).to.equal(0);
        });

        it('Should deduct a non-zero fee and send it to the fee collector', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, usdcMock, mockFeeManager } = ctx;
            const { expected } = await prepareRedemption(ctx);
            await mockFeeManager.setRedemptionFee(500); // 0.5%
            const fee = await mockFeeManager.getFee(expected);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected - fee);
            expect(await usdcMock.balanceOf(FEE_COLLECTOR)).to.equal(fee);
        });

        it('Should revert with slippage error when min output is not met', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            const { expected } = await prepareRedemption(ctx);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, expected + 1n),
            ).revertedWithCustomError(redemption, 'SlippageControlError');
        });

        it('Should revert with InsufficientLiquidity when Grove Basin has no liquidity', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, dsTokenMock } = ctx;
            // Mint asset and approve, but do NOT fund Grove Basin
            await dsTokenMock.mint(investor.address, ASSET_AMOUNT);
            await dsTokenMock.connect(investor).approve(await redemption.getAddress(), ASSET_AMOUNT);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(ctx.liquidityProvider, 'InsufficientLiquidity');
        });

        it('Should revert when the investor has insufficient asset balance', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'InsufficientRedeemerBalance');
        });

        it('Should revert when the investor country is restricted', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx);
            await redemption.updateCountryRestriction(restrictedCountry, true);
            await ctx.mockRegistryService.setCountry(investorId, restrictedCountry);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'RestrictedCountry');
        });

        it('Should revert when the NAV rate is zero', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, zeroRateNavProviderMock } = ctx;
            await prepareRedemption(ctx);
            await redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress());
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'NonZeroNavRateError');
        });

        it('Should revert when two-step transfer is disabled', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor } = ctx;
            await prepareRedemption(ctx);
            await redemption.toggleTwoStepTransfer(false);
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(redemption, 'OneStepRedemptionNotSupportedError');
        });

        it('Should revert with PocketZeroAddressError when the Grove Basin pocket is the zero address', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { liquidityProvider, redemption, investor } = ctx;
            await prepareRedemption(ctx);
            // Point the provider at a Grove Basin whose pocket resolves to address(0).
            const zeroPocketBasin = await hre.ethers.deployContract('MockGroveBasinZeroPocket');
            await liquidityProvider.setGroveBasin(await zeroPocketBasin.getAddress());
            await expect(
                redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
            ).revertedWithCustomError(liquidityProvider, 'PocketZeroAddressError');
        });

        it('Should leave the redeemed DS token held by the Grove Basin pocket', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, dsTokenMock, groveBasinMock } = ctx;
            await prepareRedemption(ctx);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            // The DS token swapped into Grove Basin must end up custodied by its pocket.
            const pocket = await groveBasinMock.pocket();
            expect(await dsTokenMock.balanceOf(pocket)).to.equal(ASSET_AMOUNT);
        });
    });

    describe('Redeem Tolerance', function () {
        it('Should initialize the redeem tolerance to the default value', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            expect(await redemption.redeemTolerance()).to.equal(0n);
            expect(await redemption.TOLERANCE_DENOMINATOR()).to.equal(100_000n);
        });

        it('Should update the redeem tolerance and emit event', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.setRedeemTolerance(10_000n))
                .to.emit(redemption, 'RedeemToleranceUpdated')
                .withArgs(0n, 10_000n);
            expect(await redemption.redeemTolerance()).to.equal(10_000n);
        });

        it('Should require an exact NAV match by default (zero tolerance)', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, groveBasinMock, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await prepareRedemption(ctx, ASSET_AMOUNT, expected * 2n);
            // Even a 1% deviation must revert when the tolerance is zero.
            await groveBasinMock.setOutputFactor(101n, 100n);
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(redemption, 'RedeemMaxToleranceExceededError')
                .withArgs((expected * 101n) / 100n, expected);
        });

        it('Should allow setting the tolerance to the maximum (100_000)', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            await redemption.setRedeemTolerance(100_000n);
            expect(await redemption.redeemTolerance()).to.equal(100_000n);
        });

        it('Should revert when the tolerance exceeds the denominator', async function () {
            const { redemption } = await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.setRedeemTolerance(100_001n))
                .revertedWithCustomError(redemption, 'InvalidToleranceError')
                .withArgs(100_001n);
        });

        it('Should fail to set the tolerance from a non-admin wallet', async function () {
            const { redemption, stranger } = await loadFixture(deployGroveBasinProtocol);
            await expect(redemption.connect(stranger).setRedeemTolerance(1_000n)).revertedWithCustomError(
                redemption,
                'AccessControlUnauthorizedAccount',
            );
        });

        it('Should redeem when the delivered value is within the tolerance band', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, usdcMock, groveBasinMock, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await redemption.setRedeemTolerance(5_000n); // 5% band
            // Deliver 102% of the expected value (inside the 5% band) and fund accordingly.
            await prepareRedemption(ctx, ASSET_AMOUNT, expected * 2n);
            await groveBasinMock.setOutputFactor(102n, 100n);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal((expected * 102n) / 100n);
        });

        it('Should revert when the delivered value exceeds the maximum tolerable amount', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, groveBasinMock, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await redemption.setRedeemTolerance(5_000n); // 5% band
            // Deliver 110% of the expected value, above the 5% upper bound.
            await prepareRedemption(ctx, ASSET_AMOUNT, expected * 2n);
            await groveBasinMock.setOutputFactor(110n, 100n);

            const maxTolerable = (expected * 105_000n) / 100_000n;
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(redemption, 'RedeemMaxToleranceExceededError')
                .withArgs((expected * 110n) / 100n, maxTolerable);
        });

        it('Should revert when the delivered value is below the minimum tolerable amount', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, groveBasinMock, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await redemption.setRedeemTolerance(5_000n); // 5% band
            // Deliver 90% of the expected value, below the 5% lower bound.
            await prepareRedemption(ctx, ASSET_AMOUNT, expected);
            await groveBasinMock.setOutputFactor(90n, 100n);

            const minTolerable = (expected * 95_000n) / 100_000n;
            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(redemption, 'RedeemMinToleranceExceededError')
                .withArgs((expected * 90n) / 100n, minTolerable);
        });

        it('Should redeem within the tolerance band when a non-zero fee applies', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, usdcMock, groveBasinMock, mockFeeManager, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await mockFeeManager.setRedemptionFee(500); // 0.5%
            await redemption.setRedeemTolerance(5_000n); // 5% band
            // Grove delivers 102% of the NAV expectation (gross); inside the band even after fee.
            await prepareRedemption(ctx, ASSET_AMOUNT, expected * 2n);
            await groveBasinMock.setOutputFactor(102n, 100n);

            // Net amounts are compared against net amounts: fee is charged on the delivered (gross) value.
            const suppliedAmount = (expected * 102n) / 100n;
            const fee = await mockFeeManager.getFee(suppliedAmount);
            const liquidityValue = suppliedAmount - fee;

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            expect(await usdcMock.balanceOf(investor.address)).to.equal(liquidityValue);
            expect(await usdcMock.balanceOf(FEE_COLLECTOR)).to.equal(fee);
        });

        it('Should revert below the minimum tolerable amount accounting for a non-zero fee', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol);
            const { redemption, investor, groveBasinMock, mockFeeManager, assetDecimals, liquidityDecimals } = ctx;
            const expected = expectedOutput(ASSET_AMOUNT, assetDecimals, liquidityDecimals);
            await mockFeeManager.setRedemptionFee(500); // 0.5%
            await redemption.setRedeemTolerance(5_000n); // 5% band
            // Grove delivers 90% of the NAV expectation (gross); below the lower bound even after fee.
            await prepareRedemption(ctx, ASSET_AMOUNT, expected);
            await groveBasinMock.setOutputFactor(90n, 100n);

            // Expected net (after fee on our NAV expectation) and the resulting min tolerable bound.
            const expectedNet = expected - (await mockFeeManager.getFee(expected));
            const minTolerable = (expectedNet * 95_000n) / 100_000n;
            // Delivered net (after fee on the 90% delivered amount).
            const suppliedAmount = (expected * 90n) / 100n;
            const liquidityValue = suppliedAmount - (await mockFeeManager.getFee(suppliedAmount));

            await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                .revertedWithCustomError(redemption, 'RedeemMinToleranceExceededError')
                .withArgs(liquidityValue, minTolerable);
        });
    });

    describe('Redeem with different decimals', function () {
        it('Should redeem at 1:1 when asset has 6 and liquidity has 18 decimals', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol6x18);
            const { redemption, investor, usdcMock } = ctx;
            const { expected } = await prepareRedemption(ctx);

            await redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
            expect(await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT)).to.equal(expected);
        });

        it('Should redeem at 1:1 when asset has 18 and liquidity has 6 decimals', async function () {
            const ctx = await loadFixture(deployGroveBasinProtocol18x6);
            const { redemption, investor, usdcMock, navProviderMock } = ctx;
            const assetAmount = 5n * 10n ** 18n;
            const { expected } = await prepareRedemption(ctx, assetAmount);

            expect(await navProviderMock.rate()).to.equal(parityRate(18));
            await redemption.connect(investor).redeem(assetAmount, MIN_OUTPUT_AMOUNT);
            expect(await usdcMock.balanceOf(investor.address)).to.equal(expected);
        });
    });
});
