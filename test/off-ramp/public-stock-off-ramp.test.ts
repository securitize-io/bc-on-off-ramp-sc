import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {
    deployPublicStockOffRamp,
    FIXED_AMM_PRICE,
    ASSET_AMOUNT,
    MIN_OUTPUT_AMOUNT,
    MARKET_STATUS_OPEN,
    MARKET_STATUS_CLOSED,
    restrictedCountry,
} from './public-stock-off-ramp.fixture';
import { eip712PublicStockOffRampRedeem } from './eip-712-public-stock.helper';

describe('PublicStockOffRamp Unit Tests', function () {
    describe('Creation & Initialization', function () {
        it('Should get implementation address correctly', async function () {
            const { offRamp } = await loadFixture(deployPublicStockOffRamp);
            expect(await offRamp.getImplementationAddress()).to.exist.and.not.equal(hre.ethers.ZeroAddress);
        });

        it('Should fail when trying to re-initialize', async function () {
            const { offRamp, dsToken, ammNavProvider, feeManager } = await loadFixture(deployPublicStockOffRamp);

            await expect(
                offRamp.initialize(
                    await dsToken.getAddress(),
                    await ammNavProvider.getAddress(),
                    await feeManager.getAddress(),
                    false,
                ),
            ).revertedWithCustomError(offRamp, 'InvalidInitialization');
        });

        it('Should fail when initializing with zero address NAV provider', async function () {
            const { dsToken, feeManager } = await loadFixture(deployPublicStockOffRamp);

            const PublicStockOffRamp = await hre.ethers.getContractFactory('PublicStockOffRamp');
            await expect(
                hre.upgrades.deployProxy(PublicStockOffRamp, [
                    await dsToken.getAddress(),
                    hre.ethers.ZeroAddress,
                    await feeManager.getAddress(),
                    false,
                ]),
            ).revertedWithCustomError(PublicStockOffRamp, 'NonZeroAddressError');
        });

        it('Should get version correctly', async function () {
            const { offRamp } = await loadFixture(deployPublicStockOffRamp);
            expect(await offRamp.getInitializedVersion()).to.equal(1);
        });
    });

    describe('Access Control', function () {
        it('Should fail when non-operator tries to call redeem', async function () {
            const { offRamp, investor, unauthorized, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
                investor,
                await offRamp.getAddress(),
                assetAmount,
                minOutputAmount,
                await offRamp.nonces(investor.address),
                deadline,
            );

            await expect(
                offRamp
                    .connect(unauthorized)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).revertedWithCustomError(offRamp, 'AccessControlUnauthorizedAccount');
        });

        it('Should fail when unauthorized tries to pause', async function () {
            const { offRamp, unauthorized } = await loadFixture(deployPublicStockOffRamp);

            await expect(offRamp.connect(unauthorized).pause()).revertedWithCustomError(
                offRamp,
                'AccessControlUnauthorizedAccount',
            );
        });
    });

    describe('Pause/Unpause', function () {
        it('Should pause contract successfully', async function () {
            const { offRamp } = await loadFixture(deployPublicStockOffRamp);

            await offRamp.pause();
            expect(await offRamp.paused()).to.equal(true);
        });

        it('Should fail to redeem when paused', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp.pause();

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(offRamp, 'EnforcedPause');
        });
    });

    describe('EIP-712 Signature Verification', function () {
        it('Should accept valid investor signature', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).to.emit(offRamp, 'RedemptionCompleted');

            expect(await liquidityToken.balanceOf(investor.address)).to.equal(20000000n);
        });

      it('Should reject if the deadline is expired', async function () {
        const { offRamp, investor, operator, dsToken, liquidityToken } =
          await loadFixture(deployPublicStockOffRamp);

        const assetAmount = ASSET_AMOUNT;
        const minOutputAmount = MIN_OUTPUT_AMOUNT;
        const anchorPrice = FIXED_AMM_PRICE;
        const anchorPriceExpiresAt = await time.latest() + 1000;

        await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

        const deadline = await time.latest() - 1000;

        const signature = await eip712PublicStockOffRampRedeem(
          investor,
          await offRamp.getAddress(),
          assetAmount,
          minOutputAmount,
          await offRamp.nonces(investor.address),
          deadline,
        );

        await expect(
          offRamp
            .connect(operator)
            .redeem(
              assetAmount,
              minOutputAmount,
              investor.address,
              signature,
              MARKET_STATUS_OPEN,
              anchorPrice,
              anchorPriceExpiresAt,
              deadline,
            ),
        ).revertedWithCustomError(offRamp, 'SignatureDeadlineExpiredError');
      });

        it('Should reject signature from wrong signer', async function () {
            const { offRamp, investor, operator, unauthorized, dsToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            // Sign with unauthorized wallet instead of investor
            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              unauthorized,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(offRamp, 'InvalidEIP712SignatureError');
        });

        it('Should reject when assetAmount is modified after signing', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const modifiedAssetAmount = assetAmount * 2n;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), modifiedAssetAmount);

            // Sign with original amount
            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            // Execute with modified amount
            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        modifiedAssetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).revertedWithCustomError(offRamp, 'InvalidEIP712SignatureError');
        });

        it('Should reject when minOutputAmount is modified after signing', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const modifiedMinOutputAmount = 5000000n;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            // Sign with original minOutputAmount
            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            // Execute with modified minOutputAmount
            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        modifiedMinOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(offRamp, 'InvalidEIP712SignatureError');
        });
    });

    describe('Price Expiration', function () {
        it('Should accept redeem with valid expiration (future timestamp)', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            expect(await liquidityToken.balanceOf(investor.address)).to.equal(20000000n);
        });

        it('Should reject redeem when anchorPriceExpiresAt is in the past', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = (await hre.ethers.provider.getBlock('latest'))!.timestamp - 1;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).revertedWithCustomError(offRamp, 'PriceExpiredError');
        });
    });

    describe('Redeem Success Cases', function () {
        it('Should redeem successfully with valid signature and parameters', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            const initialDsBalance = await dsToken.balanceOf(investor.address);

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline,
                );

            expect(await dsToken.balanceOf(investor.address)).to.equal(initialDsBalance - assetAmount);
            expect(await liquidityToken.balanceOf(investor.address)).to.equal(20000000n);
        });

        it('Should emit RedemptionCompleted event with correct values', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            const tx = await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            const receipt = await tx.wait();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const redemptionEvent = receipt?.logs.find((log: any) => {
                try {
                    return offRamp.interface.parseLog(log)?.name === 'RedemptionCompleted';
                } catch {
                    return false;
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(redemptionEvent).to.not.be.undefined;
            const parsedEvent = offRamp.interface.parseLog(redemptionEvent!);
            expect(parsedEvent?.args[0]).to.equal(investor.address); // redeemer
            expect(parsedEvent?.args[1]).to.equal(assetAmount); // dsTokenValue
            expect(parsedEvent?.args[2]).to.equal(20000000n); // liquidityValue
            expect(parsedEvent?.args[3]).to.equal(FIXED_AMM_PRICE); // rate
            expect(parsedEvent?.args[4]).to.equal(0n); // fee
            expect(parsedEvent?.args[5]).to.equal(await liquidityToken.getAddress()); // liquidityToken
        });

        it('Should work with market status closed (0)', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_CLOSED,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline,
                );

            expect(await liquidityToken.balanceOf(investor.address)).to.equal(20000000n);
        });
    });

    describe('Redeem Failure Cases', function () {
        it('Should fail when anchor price is 0', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = 0n;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).revertedWithCustomError(offRamp, 'NonZeroNavRateError');
        });

        it('Should fail when investor has insufficient asset balance', async function () {
            const { offRamp, investor, operator, dsToken } = await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT * 1000n; // More than investor has
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(offRamp, 'InsufficientRedeemerBalance');
        });
    });

    describe('AMM Integration', function () {
        it('Should use execution price from AMM', async function () {
            const { offRamp, investor, operator, dsToken, ammNavProvider, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const newPrice = 3000000n; // 3.0 in base asset decimals (6 decimals)
            await ammNavProvider.setExecutionPrice(newPrice);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = 3000000000000000000n; // 3.0 in WAD (for anchor price parameter)
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            // With higher price (3.0 vs 2.0), should receive more liquidity tokens
            // Expected: (10000000 * 3000000) / 10^6 = 30000000
            expect(await liquidityToken.balanceOf(investor.address)).to.equal(30000000n);
        });
    });

    describe('Country Restrictions', function () {
        it('Should allow redemption for non-restricted country', async function () {
            const { offRamp, investor, operator, dsToken, liquidityToken } =
                await loadFixture(deployPublicStockOffRamp);

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await offRamp
                .connect(operator)
                .redeem(
                    assetAmount,
                    minOutputAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            expect(await liquidityToken.balanceOf(investor.address)).to.equal(20000000n);
        });

        it('Should block redemption for restricted country', async function () {
            const { offRamp, investor, operator, dsToken, mockRegistryService } =
                await loadFixture(deployPublicStockOffRamp);

            // Set country restriction
            await offRamp.updateCountriesRestriction([restrictedCountry], true);

            // Update investor country to restricted one
            await mockRegistryService.updateInvestor(
                'investorId',
                '0x',
                restrictedCountry,
                [investor.address],
                [],
                [],
                [],
            );

            const assetAmount = ASSET_AMOUNT;
            const minOutputAmount = MIN_OUTPUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await dsToken.connect(investor).approve(await offRamp.getAddress(), assetAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOffRampRedeem(
              investor,
              await offRamp.getAddress(),
              assetAmount,
              minOutputAmount,
              await offRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                offRamp
                    .connect(operator)
                    .redeem(
                        assetAmount,
                        minOutputAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(offRamp, 'RestrictedCountry');
        });

        it('Should update country restrictions correctly', async function () {
            const { offRamp } = await loadFixture(deployPublicStockOffRamp);

            // Set restriction
            await offRamp.updateCountriesRestriction([restrictedCountry], true);
            expect(await offRamp.restrictedCountries(restrictedCountry)).to.equal(true);

            // Remove restriction
            await offRamp.updateCountriesRestriction([restrictedCountry], false);
            expect(await offRamp.restrictedCountries(restrictedCountry)).to.equal(false);
        });
    });
});
