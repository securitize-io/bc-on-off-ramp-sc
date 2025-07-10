/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

describe.only('Comprehensive Redeem Combinations Test', function () {
    // Base constants
    const RATE = 1000000; // NAV rate 1:1 (both tokens have 6 decimals)
    const FEE_RATE = 10000; // 10% fee (in basis points)
    const INVESTOR_ID = 'test-investor';
    const INVESTOR_COUNTRY = 'AR';
    const ASSET_AMOUNT = 10; // 10 DS tokens

    // Configuration matrices for dynamic combination generation
    const configMatrix = {
        twoSteps: [false, true],
        assetBurn: [false, true],
        fee: [true, false],
        rate: [RATE, RATE * 2],
        decimals: [
            { name: 'same', dsDecimals: 6, usdcDecimals: 6 },
            { name: 'more', dsDecimals: 18, usdcDecimals: 6 },
            { name: 'less', dsDecimals: 6, usdcDecimals: 9 },
        ],
        providerType: [
            { name: 'allowance', type: 'allowance' },
            {
                name: 'collateral',
                type: 'collateral',
                externalCollateralFee: [true, false],
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
        const [deployer, securitizeWallet, investor, feeCollector] = await hre.ethers.getSigners();

        // Deploy registry and trust services
        const trustService = await hre.ethers.deployContract('MockTrustService', []);

        const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
        const registryService = await MockRegistryService.deploy();
        await registryService.updateInvestor(INVESTOR_ID, '0x', INVESTOR_COUNTRY, [investor.address], [], [], []);

        const navProvider = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [rate]);

        // Fee manager based on config
        const feeRate = fee ? FEE_RATE : 0;
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
            decimals.dsDecimals,
            await registryService.getAddress(),
            await trustService.getAddress(),
        ]);

        const usdc = await hre.ethers.deployContract('MockERC20', ['USD Coin', 'USDC', decimals.usdcDecimals]);

        // Setup balances and approvals
        const assetAmount = BigInt(ASSET_AMOUNT) * 10n ** BigInt(decimals.dsDecimals); // Adjust for decimals

        const usdcAmount = BigInt(ASSET_AMOUNT) * 10n ** BigInt(decimals.usdcDecimals); // Adjust for decimals

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
                verboseLogs: false,
            });
            redemption = result.redemption;
            liquidityProvider = result.liquidityProvider;

            // securitizeWallet has USDC and approves liquidity provider
            await (usdc as any)
                .connect(deployer)
                .mint(securitizeWallet.address, rate === RATE ? usdcAmount : usdcAmount * 2n);
            await (usdc as any)
                .connect(securitizeWallet)
                .approve(await liquidityProvider.getAddress(), rate === RATE ? usdcAmount : usdcAmount * 2n);

            // Investor has Main DS tokens and approves for redemption
            await (mainDsToken as any).connect(deployer).mint(investor.address, assetAmount);
            await (mainDsToken as any).connect(investor).approve(await redemption.getAddress(), assetAmount);
        } else {
            const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
                await mainDsToken.getAddress(), // The asset
                await usdc.getAddress(), // The liquidity token
                externalCollateralFee ? FEE_RATE : 0,
            ]);

            const mockAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
                await usdc.getAddress(),
                await mainDsToken.getAddress(),
                await externalRedemptionContractMock.getAddress(),
            ]);
            await externalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

            const result = await hre.run('deploy-redemption-collateral-protocol', {
                asset: await secondDsToken.getAddress(),
                navProvider: await navProvider.getAddress(),
                feeManager: await feeManager.getAddress(),
                assetBurn: assetBurn.toString(),
                liquidityToken: await usdc.getAddress(),
                recipient: securitizeWallet.address,
                providerWallet: securitizeWallet.address,
                externalCollateralRedemption: await externalRedemptionContractMock.getAddress(),
                verboseLogs: false,
            });

            redemption = result.redemption;
            liquidityProvider = result.liquidityProvider;

            // externalRedemptionContractMock has USDC
            await (usdc as any)
                .connect(deployer)
                .mint(await externalRedemptionContractMock.getAddress(), rate === RATE ? usdcAmount : usdcAmount * 2n);

            // securitizeWallet.address has Main DS tokens and approves liquidity provider
            // Same amount as USDC, because the rate of the mock is always 1:1
            await (mainDsToken as any)
                .connect(deployer)
                .mint(securitizeWallet.address, rate === RATE ? usdcAmount : usdcAmount * 2n);
            await (mainDsToken as any)
                .connect(securitizeWallet)
                .approve(await liquidityProvider.getAddress(), rate === RATE ? usdcAmount : usdcAmount * 2n);

            // Investor has Second DS tokens and approves for redemption
            await (secondDsToken as any).connect(deployer).mint(investor.address, assetAmount);
            await (secondDsToken as any).connect(investor).approve(await redemption.getAddress(), assetAmount);
        }

        if (twoSteps) {
            await redemption.connect(deployer).toggleTwoStepTransfer(true);
        }

        return {
            redemption,
            // liquidityProvider,
            mainDsToken,
            secondDsToken,
            usdc,
            // feeManager,
            deployer,
            investor,
            // feeCollector,
            // securitizeWallet,
            assetAmount,
            // usdcAmount,
        };
    }

    describe('Generated Combination Tests', function () {
        const allCombinations = generateTestCombinations();

        console.log(`\n🎯 Generated ${allCombinations.length} test combinations`);

        // events RedemptionCompleted
        allCombinations.forEach((config) => {
            it(`[${config.id}] should work for: ${config.name}`, async function () {
                console.log(`\n--- Testing Combination ${config.id}: ${config.name} ---`);

                // Create a named fixture function for this specific configuration
                const setupForThisConfig = () => deployConfigurableSetup(config);

                const { redemption, mainDsToken, usdc, investor, assetAmount } = await loadFixture(setupForThisConfig);

                const minOutputAmount = 0; // For simplicity

                await expect(redemption.connect(investor).redeem(assetAmount, minOutputAmount)).to.emit(
                    redemption,
                    'RedemptionCompleted',
                );

                const expectedAmount = await redemption.calculateLiquidityTokenAmount(assetAmount);

                // Verify basic balance changes
                expect(await mainDsToken.balanceOf(investor.address)).to.equal(0);
                expect(await usdc.balanceOf(investor.address)).to.be.equal(expectedAmount);

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
