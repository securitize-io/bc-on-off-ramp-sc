/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

describe('Comprehensive Redeem Combinations Test', function () {
    // Base constants
    const RATE = 1n; // NAV rate 1:1 (both tokens have 6 decimals)
    const FEE_RATE = 10000n; // 10% fee (in basis points)
    const INVESTOR_ID = 'test-investor';
    const INVESTOR_COUNTRY = 'AR';
    const ASSET_AMOUNT = 10n; // 10 DS tokens

    // Configuration matrices for dynamic combination generation
    const configMatrix = {
        twoSteps: [false, true],
        assetBurn: [false, true],
        fee: [true, false],
        rate: [RATE, RATE * 2n],

        // twoSteps: [true],
        // assetBurn: [false],
        // fee: [false],
        // rate: [RATE],
        decimals: [
            { name: 'same', dsDecimals: 10n, usdcDecimals: 6n, collateralDsDecimals: 18n },
            { name: 'more', dsDecimals: 18n, usdcDecimals: 6n, collateralDsDecimals: 18n },
            { name: 'more', dsDecimals: 3n, usdcDecimals: 0n, collateralDsDecimals: 3n },
            { name: 'less', dsDecimals: 6n, usdcDecimals: 9n, collateralDsDecimals: 6n },
        ],
        providerType: [
            { name: 'allowance', type: 'allowance' },
            {
                name: 'collateral',
                type: 'collateral',
                externalCollateralFee: [true, false],
                // externalCollateralFee: [false],
            },
        ],
    };

    // Generate all possible combinations dynamically
    function generateTestCombinations() {
        const combinations: any[] = [];
        let combinationId = 1;

        for (const twoSteps of configMatrix.twoSteps) {
            for (const assetBurn of configMatrix.assetBurn) {
                for (const fee of configMatrix.fee) {
                    for (const rate of configMatrix.rate) {
                        for (const decimals of configMatrix.decimals) {
                            for (const provider of configMatrix.providerType) {
                                if (provider.type === 'allowance') {
                                    // Allowance provider
                                    combinations.push({
                                        id: combinationId++,
                                        twoSteps,
                                        assetBurn,
                                        fee,
                                        rate,
                                        decimals,
                                        providerType: provider.type,
                                        externalCollateralFee: null,
                                        name: `${provider.name}-${twoSteps ? 'twoStep' : 'normal'}-${assetBurn ? 'burn' : 'noBurn'}-${fee ? 'fee' : 'noFee'}-${decimals.name}Decimals-${rate === RATE ? 'rate-1.1' : 'rate-1.2'}`,
                                    });
                                } else {
                                    // Collateral provider
                                    for (const externalCollateralFee of provider.externalCollateralFee!) {
                                        combinations.push({
                                            id: combinationId++,
                                            twoSteps,
                                            assetBurn,
                                            fee,
                                            rate,
                                            decimals,
                                            providerType: provider.type,
                                            externalCollateralFee,
                                            name: `${provider.name}-${twoSteps ? 'twoStep' : 'normal'}-${assetBurn ? 'burn' : 'noBurn'}-${fee ? 'fee' : 'noFee'}-${decimals.name}Decimals-${rate === RATE ? 'rate-1.1' : 'rate-1.2'}-${externalCollateralFee ? 'collFee' : 'noCollFee'}`,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return combinations;
    }

    // Deploy function that handles different configurations
    async function deployConfigurableSetup({
        twoSteps,
        assetBurn,
        fee,
        rate,
        decimals,
        providerType,
        externalCollateralFee,
    }: any) {
        const [deployer, securitizeWallet, investor, feeCollector, unauthorized] = await hre.ethers.getSigners();

        // Deploy registry and trust services
        const trustService = await hre.ethers.deployContract('MockTrustService', []);

        const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
        const registryService = await MockRegistryService.deploy();
        await registryService.updateInvestor(INVESTOR_ID, '0x', INVESTOR_COUNTRY, [investor.address], [], [], []);

        const rateInDsDecimals = rate * 10n ** decimals.dsDecimals;
        const navProvider = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [rateInDsDecimals]);

        // Fee manager based on config
        const feeRate = fee ? FEE_RATE : 0n;
        const feeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [feeRate, feeCollector.address]);

        // Tokens with dynamic decimals
        const mainDsToken = await hre.ethers.deployContract('MockDSToken', [
            'TestMainDSToken',
            'TMDST',
            decimals.dsDecimals,
            await registryService.getAddress(),
            await trustService.getAddress(),
        ]);

        // Tokens with dynamic decimals
        const secondDsToken = await hre.ethers.deployContract('MockDSToken', [
            'TestSecondDSToken',
            'TSDST',
            decimals.collateralDsDecimals,
            await registryService.getAddress(),
            await trustService.getAddress(),
        ]);

        const usdc = await hre.ethers.deployContract('MockERC20', ['USD Coin', 'USDC', decimals.usdcDecimals]);

        // Setup balances and approvals
        const assetAmount = BigInt(ASSET_AMOUNT) * 10n ** BigInt(decimals.dsDecimals); // Adjust for decimals
        const secondAssetAmountBase = BigInt(ASSET_AMOUNT) * 10n ** BigInt(decimals.collateralDsDecimals); // Adjust for decimals
        const secondAssetAmount = rate === RATE ? secondAssetAmountBase : secondAssetAmountBase * 2n;

        const usdcAmountBase = BigInt(ASSET_AMOUNT) * 10n ** BigInt(decimals.usdcDecimals); // Adjust for decimals
        const usdcAmount = rate === RATE ? usdcAmountBase : usdcAmountBase * 2n;

        // Deploy based on provider type
        let redemption, liquidityProvider;

        if (providerType === 'allowance') {
            const result = await hre.run('deploy-redemption-allowance-protocol', {
                asset: await mainDsToken.getAddress(),
                navProvider: await navProvider.getAddress(),
                feeManager: await feeManager.getAddress(),
                assetBurn: assetBurn.toString(),
                recipient: securitizeWallet.address,
                liquidityToken: await usdc.getAddress(),
                providerWallet: securitizeWallet.address,
                silenceLogs: true,
            });
            redemption = result.redemption;
            liquidityProvider = result.liquidityProvider;

            // securitizeWallet has USDC and approves liquidity provider
            await (usdc as any).connect(deployer).mint(securitizeWallet.address, usdcAmount);
            await (usdc as any).connect(securitizeWallet).approve(await liquidityProvider.getAddress(), usdcAmount);

            // Investor has Main DS tokens and approves for redemption
            await (mainDsToken as any).connect(deployer).mint(investor.address, assetAmount);
            await (mainDsToken as any).connect(investor).approve(await redemption.getAddress(), assetAmount);
        } else {
            const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
                await secondDsToken.getAddress(), // The asset
                await usdc.getAddress(), // The liquidity token
                externalCollateralFee ? FEE_RATE : 0,
            ]);

            const mockAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
                await usdc.getAddress(),
                await secondDsToken.getAddress(),
                await externalRedemptionContractMock.getAddress(),
            ]);
            await externalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

            const result = await hre.run('deploy-redemption-collateral-protocol', {
                asset: await mainDsToken.getAddress(),
                navProvider: await navProvider.getAddress(),
                feeManager: await feeManager.getAddress(),
                assetBurn: assetBurn.toString(),
                liquidityToken: await usdc.getAddress(),
                recipient: securitizeWallet.address,
                providerWallet: securitizeWallet.address,
                externalCollateralRedemption: await externalRedemptionContractMock.getAddress(),
                silenceLogs: true,
            });

            redemption = result.redemption;
            liquidityProvider = result.liquidityProvider;

            // externalRedemptionContractMock has USDC
            await (usdc as any).connect(deployer).mint(await externalRedemptionContractMock.getAddress(), usdcAmount);

            // Investor has Main DS tokens and approves for redemption
            await (mainDsToken as any).connect(deployer).mint(investor.address, assetAmount);
            await (mainDsToken as any).connect(investor).approve(await redemption.getAddress(), assetAmount);

            // Securitize Wallet has Second DS tokens and approves for redemption
            await (secondDsToken as any).connect(deployer).mint(securitizeWallet.address, secondAssetAmount);
            await (secondDsToken as any)
                .connect(securitizeWallet)
                .approve(await liquidityProvider.getAddress(), secondAssetAmount);
        }

        return {
            redemption,
            // liquidityProvider,
            mainDsToken,
            secondDsToken,
            usdc,
            // feeManager,
            deployer,
            unauthorized,
            investor,
            feeCollector,
            securitizeWallet,
            assetAmount,
            usdcAmount,
            secondAssetAmount,
            assetBurn,
            providerType,
            twoSteps,
        };
    }

    describe('Generated Combination Tests', function () {
        const allCombinations = generateTestCombinations();

        console.log(`\n🎯 Generated ${allCombinations.length} test combinations`);

        // events: RedemptionCompleted, TwoStepTransferUpdated, OwnableUnauthorizedAccount
        // flows: assetBurned
        allCombinations.forEach((config) => {
            it(`[${config.id}] should work for: ${config.name}`, async function () {
                console.log(`\n--- Testing Combination ${config.id}: ${config.name} ---`);

                // Create a named fixture function for this specific configuration
                const setupForThisConfig = () => deployConfigurableSetup(config);

                const {
                    unauthorized,
                    securitizeWallet,
                    investor,
                    feeCollector,
                    assetAmount,
                    secondAssetAmount,
                    usdcAmount,
                    redemption,
                    mainDsToken,
                    secondDsToken,
                    usdc,
                    assetBurn,
                    providerType,
                    twoSteps,
                } = await loadFixture(setupForThisConfig);
                if (twoSteps) {
                    // Initially should be false
                    expect(await redemption.twoStepTransfer()).to.equal(false);

                    // Enable two-step transfer
                    await expect(redemption.toggleTwoStepTransfer(true))
                        .to.emit(redemption, 'TwoStepTransferUpdated')
                        .withArgs(true);
                    expect(await redemption.twoStepTransfer()).to.equal(true);

                    // Disable two-step transfer
                    await expect(redemption.toggleTwoStepTransfer(false))
                        .to.emit(redemption, 'TwoStepTransferUpdated')
                        .withArgs(false);
                    expect(await redemption.twoStepTransfer()).to.equal(false);

                    // Should fail when trying to toggle with unauthorized wallet
                    const redemptionFromUnauthorized = await redemption.connect(unauthorized);
                    await expect(redemptionFromUnauthorized.toggleTwoStepTransfer(true)).revertedWithCustomError(
                        redemption,
                        'OwnableUnauthorizedAccount',
                    );

                    // Enable again to continue the test
                    await redemption.toggleTwoStepTransfer(true);
                    expect(await redemption.twoStepTransfer()).to.equal(true);
                }

                if (providerType === 'allowance') {
                    // Check initial Investor balances
                    expect(await mainDsToken.balanceOf(investor.address)).to.equal(assetAmount);
                    expect(await usdc.balanceOf(investor.address)).to.equal(0);
                    // Check initial Securitize Wallet balances
                    expect(await mainDsToken.balanceOf(securitizeWallet.address)).to.be.equal(0);
                    expect(await usdc.balanceOf(securitizeWallet.address)).to.be.equal(usdcAmount);
                    // Check initial Fee Collector balances
                    expect(await usdc.balanceOf(feeCollector)).to.be.equal(0);
                } else {
                    // Check initial Investor balances
                    expect(await mainDsToken.balanceOf(investor.address)).to.equal(assetAmount);
                    expect(await usdc.balanceOf(investor.address)).to.equal(0);
                    // Check initial Securitize Wallet balances
                    // Same amount as USDC, because the rate of the mock is always 1:1
                    expect(await secondDsToken.balanceOf(securitizeWallet.address)).to.be.equal(secondAssetAmount);
                    // // Check initial Fee Collector balances
                    expect(await usdc.balanceOf(feeCollector)).to.be.equal(0);
                }
                const minOutputAmount = 0; // For simplicity

                const expectedAmount = await redemption.calculateLiquidityTokenAmount(assetAmount);

                await expect(redemption.connect(investor).redeem(assetAmount, minOutputAmount)).to.emit(
                    redemption,
                    'RedemptionCompleted',
                );

                if (providerType === 'allowance') {
                    // Check final Investor balances
                    expect(await mainDsToken.balanceOf(investor.address)).to.equal(0);
                    expect(await usdc.balanceOf(investor.address)).to.be.equal(expectedAmount);

                    // Check final Securitize Wallet balances
                    expect(await mainDsToken.balanceOf(securitizeWallet.address)).to.be.equal(
                        assetBurn ? 0 : assetAmount,
                    );
                    expect(await usdc.balanceOf(securitizeWallet.address)).to.be.equal(0);
                    // Check final Fee Collector balances
                    // expect(await usdc.balanceOf(feeCollector)).to.be.equal(0);
                } else {
                    // Check final Investor balances
                    expect(await mainDsToken.balanceOf(investor.address)).to.equal(0);
                    expect(await usdc.balanceOf(investor.address)).to.be.equal(expectedAmount);
                    // Check final Securitize Wallet balances
                    expect(await mainDsToken.balanceOf(securitizeWallet.address)).to.be.equal(
                        assetBurn ? 0 : assetAmount,
                    );
                    expect(await secondDsToken.balanceOf(securitizeWallet.address)).to.be.equal(0);
                    expect(await usdc.balanceOf(securitizeWallet.address)).to.be.equal(0);
                    // Check final Fee Collector balances
                    // expect(await usdc.balanceOf(feeCollector)).to.be.equal(0);
                }

                console.log(`✓ Combination ${config.id} passed`);
            });
        });
        // errors SlippageControlError
        allCombinations.forEach((config) => {
            it(`[${config.id}] should revert if the expected amount is more than the real amount after fee, config[${config.name}]`, async function () {
                console.log(`\n--- Testing Combination ${config.id}: ${config.name} ---`);

                // Create a named fixture function for this specific configuration
                const setupForThisConfig = () => deployConfigurableSetup(config);

                const { redemption, investor, assetAmount } = await loadFixture(setupForThisConfig);

                const expectedAmount = await redemption.calculateLiquidityTokenAmount(assetAmount);

                await expect(
                    redemption.connect(investor).redeem(assetAmount, expectedAmount + 1n),
                ).to.be.revertedWithCustomError(redemption, 'SlippageControlError');

                console.log(`✓ Combination ${config.id} passed`);
            });
        });
        // RestrictedCountry
        allCombinations.forEach((config) => {
            it(`[${config.id}] should revert if the investor is from a restricted country, config[${config.name}]`, async function () {
                console.log(`\n--- Testing Combination ${config.id}: ${config.name} ---`);

                // Create a named fixture function for this specific configuration
                const setupForThisConfig = () => deployConfigurableSetup(config);

                const { redemption, deployer, investor, assetAmount } = await loadFixture(setupForThisConfig);

                // Update investor to a restricted country
                await expect(redemption.connect(deployer).updateCountryRestriction(INVESTOR_COUNTRY, true))
                    .to.emit(redemption, 'CountryRestrictionUpdated')
                    .withArgs(INVESTOR_COUNTRY, true);

                await expect(redemption.connect(investor).redeem(assetAmount, 0)).to.be.revertedWithCustomError(
                    redemption,
                    'RestrictedCountry',
                );

                console.log(`✓ Combination ${config.id} passed`);
            });
        });
    });
});
