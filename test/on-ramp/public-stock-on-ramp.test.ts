import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {
    deployPublicStockOnRamp,
    FIXED_AMM_PRICE,
    LIQUIDITY_AMOUNT,
    MIN_OUT_AMOUNT,
    MARKET_STATUS_OPEN,
    MARKET_STATUS_CLOSED,
} from './public-stock-on-ramp.fixture';
import { eip712PublicStockOnRampSwap } from './eip-712-public-stock.helper';

describe('PublicStockOnRamp Unit Tests', function () {
    describe('Creation & Initialization', function () {
        it('Should get implementation address correctly', async function () {
            const { onRamp } = await loadFixture(deployPublicStockOnRamp);
            expect(await onRamp.getImplementationAddress()).to.exist.and.not.equal(hre.ethers.ZeroAddress);
        });

        it('Should fail when trying to re-initialize', async function () {
            const { onRamp, dsToken, liquidityToken, ammNavProvider, feeManager, custodian } =
                await loadFixture(deployPublicStockOnRamp);

            await expect(
                onRamp.initialize(
                    await dsToken.getAddress(),
                    await liquidityToken.getAddress(),
                    await ammNavProvider.getAddress(),
                    await feeManager.getAddress(),
                    custodian.address,
                ),
            ).revertedWithCustomError(onRamp, 'InvalidInitialization');
        });

        it('Should fail when initializing with zero address NAV provider', async function () {
            const { dsToken, liquidityToken, feeManager, custodian } =
                await loadFixture(deployPublicStockOnRamp);

            const PublicStockOnRamp = await hre.ethers.getContractFactory('PublicStockOnRamp');
            await expect(
                hre.upgrades.deployProxy(PublicStockOnRamp, [
                    await dsToken.getAddress(),
                    await liquidityToken.getAddress(),
                    hre.ethers.ZeroAddress,
                    await feeManager.getAddress(),
                    custodian.address,
                ]),
            ).revertedWithCustomError(PublicStockOnRamp, 'NonZeroAddressError');
        });

        it('Should get version correctly', async function () {
            const { onRamp } = await loadFixture(deployPublicStockOnRamp);
            expect(await onRamp.getInitializedVersion()).to.equal(1);
        });
    });

    describe('Access Control', function () {
        it('Should fail when non-operator tries to call swap', async function () {
            const { onRamp, investor, unauthorized, liquidityToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
                investor,
                await onRamp.getAddress(),
                liquidityAmount,
                minOutAmount,
                await onRamp.nonces(investor.address),
                deadline,
            );

            await expect(
                onRamp
                    .connect(unauthorized)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).revertedWithCustomError(onRamp, 'AccessControlUnauthorizedAccount');
        });

        it('Should fail when unauthorized tries to pause', async function () {
            const { onRamp, unauthorized } = await loadFixture(deployPublicStockOnRamp);

            await expect(onRamp.connect(unauthorized).pause()).revertedWithCustomError(
                onRamp,
                'AccessControlUnauthorizedAccount',
            );
        });
    });

    describe('Pause/Unpause', function () {
        it('Should pause contract successfully', async function () {
            const { onRamp } = await loadFixture(deployPublicStockOnRamp);

            await onRamp.pause();
            expect(await onRamp.paused()).to.equal(true);
        });

        it('Should fail to swap when paused', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await onRamp.pause();

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'EnforcedPause');
        });
    });

    describe('EIP-712 Signature Verification', function () {
        it('Should accept valid investor signature', async function () {
            const { onRamp, investor, operator, liquidityToken, dsToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline
                    ),
            ).to.emit(onRamp, 'Swap');

            expect(await dsToken.balanceOf(investor.address)).to.equal(5000000n);
        });

        it('Should reject signature from wrong signer', async function () {
            const { onRamp, investor, operator, unauthorized, liquidityToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              unauthorized,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(unauthorized.address),
              deadline,
            );

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'InvalidEIP712SignatureError');
        });

        it('Should reject when liquidityAmount is modified after signing', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const modifiedLiquidityAmount = liquidityAmount * 2n;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, modifiedLiquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), modifiedLiquidityAmount);

            const deadline = await time.latest() + 1000;
            // Sign with original amount
            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );
            // Execute with modified amount
            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        modifiedLiquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'InvalidEIP712SignatureError');
        });

      it('Should reject if the deadline is expired', async function () {
        const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

        const liquidityAmount = LIQUIDITY_AMOUNT;
        const minOutAmount = MIN_OUT_AMOUNT;
        const anchorPrice = FIXED_AMM_PRICE;
        const anchorPriceExpiresAt = await time.latest() + 1000;

        await liquidityToken.mint(investor.address, liquidityAmount);
        await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

        const deadline = await time.latest() - 1;
        // Sign with original amount
        const signature = await eip712PublicStockOnRampSwap(
          investor,
          await onRamp.getAddress(),
          liquidityAmount,
          minOutAmount,
          await onRamp.nonces(investor.address),
          deadline,
        );
        await expect(
          onRamp
            .connect(operator)
            .swap(
              liquidityAmount,
              minOutAmount,
              investor.address,
              signature,
              MARKET_STATUS_OPEN,
              anchorPrice,
              anchorPriceExpiresAt,
              deadline,
            ),
        ).revertedWithCustomError(onRamp, 'SignatureDeadlineExpiredError');
      });

        it('Should reject when minOutAmount is modified after signing', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const modifiedMinOutAmount = 5000000n;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);


            const deadline = await time.latest() + 1000;
            // Sign with original minOutAmount
            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            // Execute with modified minOutAmount
            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        modifiedMinOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'InvalidEIP712SignatureError');
        });
    });

    describe('Price Expiration', function () {
        it('Should accept swap with valid expiration (future timestamp)', async function () {
            const { onRamp, investor, operator, liquidityToken, dsToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await onRamp
                .connect(operator)
                .swap(
                    liquidityAmount,
                    minOutAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline,
                );

            expect(await dsToken.balanceOf(investor.address)).to.equal(5000000n);
        });

        it('Should reject swap when anchorPriceExpiresAt is in the past', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = (await hre.ethers.provider.getBlock('latest'))!.timestamp - 1;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'PriceExpiredError');
        });
    });

    describe('Swap Success Cases', function () {
        it('Should swap successfully with valid signature and parameters', async function () {
            const { onRamp, investor, operator, liquidityToken, dsToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            const initialLiquidityBalance = await liquidityToken.balanceOf(investor.address);

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await onRamp
                .connect(operator)
                .swap(
                    liquidityAmount,
                    minOutAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            expect(await liquidityToken.balanceOf(investor.address)).to.equal(initialLiquidityBalance);
            expect(await dsToken.balanceOf(investor.address)).to.equal(5000000n);
        });

        it('Should emit Swap event with correct values', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            const tx = await onRamp
                .connect(operator)
                .swap(
                    liquidityAmount,
                    minOutAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline
                );

            const receipt = await tx.wait();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const swapEvent = receipt?.logs.find((log: any) => {
                try {
                    return onRamp.interface.parseLog(log)?.name === 'Swap';
                } catch {
                    return false;
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(swapEvent).to.not.be.undefined;
            const parsedEvent = onRamp.interface.parseLog(swapEvent!);
            expect(parsedEvent?.args[0]).to.equal(operator.address); // from
            expect(parsedEvent?.args[1]).to.be.gt(0); // dsTokenValue should be > 0
            expect(parsedEvent?.args[2]).to.equal(liquidityAmount); // liquidityValue
            expect(parsedEvent?.args[3]).to.equal(investor.address); // newWalletTo
            expect(parsedEvent?.args[4]).to.equal(FIXED_AMM_PRICE); // rate
            expect(parsedEvent?.args[5]).to.equal(0n); // fee
            expect(parsedEvent?.args[6]).to.equal(await liquidityToken.getAddress()); // liquidityToken
        });

        it('Should work with market status closed (0)', async function () {
            const { onRamp, investor, operator, liquidityToken, dsToken } =
                await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await onRamp
                .connect(operator)
                .swap(
                    liquidityAmount,
                    minOutAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_CLOSED,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline,
                );

            expect(await dsToken.balanceOf(investor.address)).to.equal(5000000n);
        });
    });

    describe('Swap Failure Cases', function () {
        it('Should fail when anchor price is 0', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = 0n;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).to.be.revertedWithCustomError(onRamp, 'NonZeroNavRateError');
        });

        it('Should fail when investor has insufficient liquidity balance', async function () {
            const { onRamp, investor, operator, liquidityToken } = await loadFixture(deployPublicStockOnRamp);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = FIXED_AMM_PRICE;
            const anchorPriceExpiresAt = await time.latest() + 1000;

            // Don't mint tokens to investor
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await expect(
                onRamp
                    .connect(operator)
                    .swap(
                        liquidityAmount,
                        minOutAmount,
                        investor.address,
                        signature,
                        MARKET_STATUS_OPEN,
                        anchorPrice,
                        anchorPriceExpiresAt,
                        deadline,
                    ),
            ).revertedWithCustomError(onRamp, 'InsufficientERC20BalanceError');
        });
    });

    describe('AMM Integration', function () {
        it('Should use execution price from AMM', async function () {
            const { onRamp, investor, operator, liquidityToken, ammNavProvider, dsToken } =
                await loadFixture(deployPublicStockOnRamp);

            const newPrice = 3000000n; // 3.0 in base asset decimals (6 decimals)
            await ammNavProvider.setExecutionPrice(newPrice);

            const liquidityAmount = LIQUIDITY_AMOUNT;
            const minOutAmount = MIN_OUT_AMOUNT;
            const anchorPrice = 3000000000000000000n; // 3.0 in WAD (for anchor price parameter)
            const anchorPriceExpiresAt = await time.latest() + 1000;

            await liquidityToken.mint(investor.address, liquidityAmount);
            await liquidityToken.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

            const deadline = await time.latest() + 1000;

            const signature = await eip712PublicStockOnRampSwap(
              investor,
              await onRamp.getAddress(),
              liquidityAmount,
              minOutAmount,
              await onRamp.nonces(investor.address),
              deadline,
            );

            await onRamp
                .connect(operator)
                .swap(
                    liquidityAmount,
                    minOutAmount,
                    investor.address,
                    signature,
                    MARKET_STATUS_OPEN,
                    anchorPrice,
                    anchorPriceExpiresAt,
                    deadline,
                );

            // With higher price (3.0 vs 2.0), should receive fewer DS tokens
            // Expected: (10000000 * 10^6) / 3000000 = 3333333
            expect(await dsToken.balanceOf(investor.address)).to.equal(3333333n);
        });
    });
});
