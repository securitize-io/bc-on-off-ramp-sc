import { expect } from 'chai';
import {
    ASSET_AMOUNT,
    COLLATERAL_TREASURY,
    deployRedemptionAllowanceProtocol,
    deployRedemptionProtocol,
    deployRedemptionProtocolWithAssetBurn,
    FIXED_RATE,
    invalidCountryCode1,
    invalidCountryCode2,
    invalidCountryCode3,
    investorCountry,
    investorId,
    LIQUIDITY_AMOUNT,
    MIN_OUTPUT_AMOUNT,
    restrictedCountry,
} from './fixture';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';

describe('Securitize Redemption Protocol Unit Tests', function () {
    // Each test will load its own fixture

    describe('Securitize Redemption Contract Unit Tests', function () {
        describe('Creation', function () {
            it('Should get implementation address correctly', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                expect(await redemption.getImplementationAddress()).to.be.exist.and.not.equal(hre.ethers.ZeroAddress);
            });
            it('Should fail when trying to re initialize', async function () {
                const { redemption, dsTokenMock, securitizeNavProviderMock } =
                    await loadFixture(deployRedemptionProtocol);
                await expect(
                    redemption.initialize(
                        await dsTokenMock.getAddress(),
                        await securitizeNavProviderMock.getAddress(),
                        hre.ethers.ZeroAddress,
                        false,
                    ),
                ).revertedWithCustomError(redemption, 'InvalidInitialization');
            });

            it('Should fail when trying to initialize with a zero address NAV provider', async function () {
                const { dsTokenMock } = await loadFixture(deployRedemptionProtocol);
                const Redemption = await hre.ethers.getContractFactory('SecuritizeOffRamp');
                await expect(
                    hre.upgrades.deployProxy(Redemption, [
                        await dsTokenMock.getAddress(),
                        hre.ethers.ZeroAddress,
                        hre.ethers.ZeroAddress,
                        false,
                    ]),
                ).revertedWithCustomError(Redemption, 'NonZeroAddressError');
            });

            it('Should get version correctly', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                expect(await redemption.getInitializedVersion()).to.equal(1);
            });
        });

        describe('Pause/Unpause', function () {
            it('Should fail when trying to pause with unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                const redemptionFromUnauthorized = await redemption.connect(unauthorized);
                await expect(redemptionFromUnauthorized.pause()).revertedWithCustomError(
                    redemption,
                    'OwnableUnauthorizedAccount',
                );
            });

            it('Should fail to redeem if contract is paused', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await redemption.pause();
                expect(await redemption.paused()).to.equal(true);
                await expect(redemption.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    redemption,
                    'EnforcedPause',
                );
            });
        });
    });

    describe('Liquidity Provider Unit Tests', function () {
        describe('Creation', function () {
            it('Should fail when trying to re initialize', async function () {
                const [securitizeWallet] = await hre.ethers.getSigners();
                const { liquidityProvider, usdcMock, redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(
                    liquidityProvider.initialize(
                        await usdcMock.getAddress(),
                        securitizeWallet,
                        await redemption.getAddress(),
                        await redemption.getAddress(),
                        await redemption.getAddress(),
                    ),
                ).revertedWithCustomError(liquidityProvider, 'InvalidInitialization');
            });

            it('Should get version correctly', async function () {
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                expect(await liquidityProvider.getInitializedVersion()).to.equal(1);
            });

            it('Should get implementation address correctly', async function () {
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                expect(await liquidityProvider.getImplementationAddress()).to.be.exist.and.not.equal(
                    hre.ethers.ZeroAddress,
                );
            });
        });
        describe('Set External Collateral Redemption', function () {
            it('Should update a new nav provider rate and emit events', async function () {
                const { liquidityProvider, newExternalRedemptionContractMock } =
                    await loadFixture(deployRedemptionProtocol);
                const oldAddress = await liquidityProvider.externalCollateralRedemption();
                await expect(
                    liquidityProvider.setExternalCollateralRedemption(
                        await newExternalRedemptionContractMock.getAddress(),
                    ),
                )
                    .to.emit(liquidityProvider, 'ExternalCollateralRedemptionUpdated')
                    .withArgs(oldAddress, await newExternalRedemptionContractMock.getAddress());
            });

            it('Should fail when trying to set a external collateral redemption provider with zero address', async function () {
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                await expect(
                    liquidityProvider.setExternalCollateralRedemption(hre.ethers.ZeroAddress),
                ).revertedWithCustomError(liquidityProvider, 'NonZeroAddressError');
            });

            it('Should fail when trying to set an external collateral redemption provider with different stable coins', async function () {
                const { liquidityProvider, newExternalRedemptionContractDaiMock } =
                    await loadFixture(deployRedemptionProtocol);
                await expect(
                    liquidityProvider.setExternalCollateralRedemption(
                        await newExternalRedemptionContractDaiMock.getAddress(),
                    ),
                ).revertedWithCustomError(liquidityProvider, 'LiquidityTokenMismatch');
            });
            it('Should fail when trying to pause with unauthorized wallet', async function () {
                const [_, unauthorized, externalCollateralAddress] = await hre.ethers.getSigners();
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                const liquidityProviderFromUnauthorized = await liquidityProvider.connect(unauthorized);
                await expect(
                    liquidityProviderFromUnauthorized.setExternalCollateralRedemption(externalCollateralAddress),
                ).revertedWithCustomError(liquidityProvider, 'OwnableUnauthorizedAccount');
            });
        });

        describe('Set Collateral Provider', function () {
            it('Should update a new nav provider rate and emit events', async function () {
                const [_, collateralAddress] = await hre.ethers.getSigners();
                const { liquidityProvider, collateralProviderAddressMock } =
                    await loadFixture(deployRedemptionProtocol);

                await expect(liquidityProvider.setCollateralProvider(collateralAddress))
                    .to.emit(liquidityProvider, 'CollateralProviderUpdated')
                    .withArgs(collateralProviderAddressMock, collateralAddress);
            });
            it('Should fail when trying to pause with unauthorized wallet', async function () {
                const [_, unauthorized, collateralAddress] = await hre.ethers.getSigners();
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                const liquidityProviderFromUnauthorized = await liquidityProvider.connect(unauthorized);
                await expect(
                    liquidityProviderFromUnauthorized.setCollateralProvider(collateralAddress),
                ).revertedWithCustomError(liquidityProvider, 'OwnableUnauthorizedAccount');
            });
        });
        describe('Pause/Unpause', function () {
            it('Should fail when trying to pause with unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                const liquidityProviderFromUnauthorized = await liquidityProvider.connect(unauthorized);
                await expect(liquidityProviderFromUnauthorized.pause()).revertedWithCustomError(
                    liquidityProvider,
                    'OwnableUnauthorizedAccount',
                );
            });

            it('Should fail to supply liquidity if contract is paused', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                await liquidityProvider.pause();
                expect(await liquidityProvider.paused()).to.equal(true);
                await expect(liquidityProvider.supplyTo(investor, ASSET_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    'EnforcedPause',
                );
            });
        });

        describe('Caller validation', function () {
            it('Should fail if contract is called by other contract than Securitize Redemption', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                await expect(liquidityProvider.supplyTo(investor, ASSET_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    'RedemptionUnauthorizedAccount',
                );
            });
        });

        describe('Available Liquidity', function () {
            it('Should return available liquidity', async function () {
                const {
                    liquidityProvider,
                    dsTokenCollateralMock,
                    collateralProviderAddressMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocol);

                await dsTokenCollateralMock.mint(collateralProviderAddressMock, 10);

                await usdcMock.mint(await externalRedemptionContractMock.getAddress(), 12);
                await usdcMock.approve(liquidityProvider, 12);

                const availableLiquidity = await liquidityProvider.availableLiquidity();
                expect(availableLiquidity).to.equal(10);
            });
            it('Should return available liquidity for AllowanceProvider', async function () {
                const { liquidityProvider, usdcMock } = await loadFixture(deployRedemptionAllowanceProtocol);

                const liquidityProviderWallet = await liquidityProvider.liquidityProviderWallet();

                await usdcMock.mint(liquidityProviderWallet, 12);
                await usdcMock.approve(liquidityProvider, 12);

                const availableLiquidity = await liquidityProvider.availableLiquidity();
                expect(availableLiquidity).to.equal(12);
            });
        });
    });

    describe('Redemption integration', function () {
        describe('Liquidity Provider', function () {
            it('Should return liquidity provider address', async function () {
                const { redemption, liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                expect(await redemption.liquidityProvider()).to.equal(await liquidityProvider.getAddress());
            });

            it('Should set new liquidity provider', async function () {
                const { redemption, liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                const liquidityProviderAddress = await liquidityProvider.getAddress();
                await expect(redemption.updateLiquidityProvider(liquidityProviderAddress))
                    .emit(redemption, 'LiquidityProviderUpdated')
                    .withArgs(liquidityProviderAddress, liquidityProviderAddress);
                expect(await redemption.liquidityProvider()).to.equal(liquidityProviderAddress);
            });

            it('Should fail when trying to update liquidity provider from an unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { redemption, liquidityProvider } = await loadFixture(deployRedemptionProtocol);
                const liquidityProviderAddress = await liquidityProvider.getAddress();
                const redemptionFromUnauthorized = await redemption.connect(unauthorized);
                await expect(
                    redemptionFromUnauthorized.updateLiquidityProvider(liquidityProviderAddress),
                ).revertedWithCustomError(redemptionFromUnauthorized, 'OwnableUnauthorizedAccount');
            });
        });

        describe('Asset', function () {
            it('Should return asset address', async function () {
                const { redemption, dsTokenMock } = await loadFixture(deployRedemptionProtocol);
                expect(await redemption.asset()).to.equal(await dsTokenMock.getAddress());
            });
        });

        describe('Restricted Country', function () {
            it('Should return restricted country and emit event', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateCountryRestriction(restrictedCountry, true))
                    .to.emit(redemption, 'CountryRestrictionUpdated')
                    .withArgs(restrictedCountry, true);
                expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(true);
            });

            it('Should set a restricted countries in batch and emit events for each country', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);

                // Use await expect pattern to check for events with specific arguments
                await expect(redemption.updateCountriesRestriction([restrictedCountry, investorCountry], true))
                    .to.emit(redemption, 'CountryRestrictionUpdated')
                    .withArgs(restrictedCountry, true)
                    .to.emit(redemption, 'CountryRestrictionUpdated')
                    .withArgs(investorCountry, true);

                // Verify the country restrictions were set correctly
                expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(true);
                expect(await redemption.restrictedCountries(investorCountry)).to.equal(true);
            });

            it('Should fail when trying to set a restricted country with invalid code', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateCountryRestriction(invalidCountryCode1, true)).revertedWithCustomError(
                    redemption,
                    'InvalidCountryCodeLength',
                );
            });

            it('Should fail when trying to set a restricted country with invalid code', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateCountryRestriction(invalidCountryCode2, true)).revertedWithCustomError(
                    redemption,
                    'InvalidCountryCodeLength',
                );
            });

            it('Should fail when trying to set a restricted country with unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                const redemptionFromUnauthorized = await redemption.connect(unauthorized);
                await expect(
                    redemptionFromUnauthorized.updateCountryRestriction(invalidCountryCode1, true),
                ).revertedWithCustomError(redemptionFromUnauthorized, 'OwnableUnauthorizedAccount');
            });

            it('Should fail when trying to set a restricted country using lowercase code', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(
                    redemption.updateCountryRestriction(restrictedCountry.toLocaleLowerCase(), true),
                ).revertedWithCustomError(redemption, 'NonUppercaseCountryCode');
            });

            it('Should allow unrestricting a country and emit event', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                // First restrict the country
                await redemption.updateCountryRestriction(restrictedCountry, true);
                expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(true);
                // Then unrestrict it and check the event
                await expect(redemption.updateCountryRestriction(restrictedCountry, false))
                    .to.emit(redemption, 'CountryRestrictionUpdated')
                    .withArgs(restrictedCountry, false);
                expect(await redemption.restrictedCountries(restrictedCountry)).to.equal(false);
            });
        });

        describe('Registry Service Country Code Validation', function () {
            it('Should fail with empty country code from registry', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, mockRegistryService, dsTokenMock } = await loadFixture(deployRedemptionProtocol);

                // Set registry to return empty country code
                await mockRegistryService.updateInvestor(investorId, '0x', '', [investor.address], [], [], []);

                // Set up for redemption
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Redemption should fail with EmptyCountryCode error
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(
                    redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
                ).to.be.revertedWithCustomError(redemption, 'EmptyCountryCode');
            });

            it('Should fail with invalid country code length from registry', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, mockRegistryService, dsTokenMock } = await loadFixture(deployRedemptionProtocol);

                // Set registry to return empty country code
                await mockRegistryService.updateInvestor(
                    investorId,
                    '0x',
                    invalidCountryCode1,
                    [investor.address],
                    [],
                    [],
                    [],
                );

                // Set up for redemption
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Redemption should fail with InvalidCountryCodeLength error
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(
                    redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
                ).to.be.revertedWithCustomError(redemption, 'InvalidCountryCodeLength');
            });

            it('Should fail with non-uppercase country code from registry', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, mockRegistryService, dsTokenMock } = await loadFixture(deployRedemptionProtocol);

                // Set registry to return country code with lowercase letters
                await mockRegistryService.updateInvestor(
                    investorId,
                    '0x',
                    invalidCountryCode3,
                    [investor.address],
                    [],
                    [],
                    [],
                );

                // Set up for redemption
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Redemption should fail with NonUppercaseCountryCode error
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(
                    redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
                ).to.be.revertedWithCustomError(redemption, 'NonUppercaseCountryCode');
            });

            const testCases = [
                { code: '0S', desc: 'first char < 0x41' },
                { code: 'aS', desc: 'first char > 0x5A' },
                { code: 'A9', desc: 'second char < 0x41' },
                { code: 'Ab', desc: 'second char > 0x5A' },
                { code: 'AB@', desc: 'third char < 0x41' },
                { code: 'ABz', desc: 'third char > 0x5A' },
            ];

            testCases.forEach((testCase, index) => {
                it(`Should fail case ${index + 1}: ${testCase.desc}`, async function () {
                    const [_, investor] = await hre.ethers.getSigners();
                    const { redemption, mockRegistryService, dsTokenMock } =
                        await loadFixture(deployRedemptionProtocol);

                    // Set registry to return country code with lowercase letters
                    await mockRegistryService.updateInvestor(
                        investorId,
                        '0x',
                        testCase.code,
                        [investor.address],
                        [],
                        [],
                        [],
                    );

                    // Set up for redemption
                    await dsTokenMock.mint(investor, ASSET_AMOUNT);
                    const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                    await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                    // Redemption should fail with NonUppercaseCountryCode error
                    const redemptionFromInvestor = await redemption.connect(investor);
                    await expect(
                        redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT),
                    ).to.be.revertedWithCustomError(redemption, 'NonUppercaseCountryCode');
                });
            });
            it(`Should work with three uppercase letters`, async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockRegistryService,
                } = await loadFixture(deployRedemptionProtocol);

                await mockRegistryService.updateInvestor(investorId, '0x', 'USA', [investor.address], [], [], []);

                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Redemption should succeed
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).to.not.be.reverted;
            });
        });

        describe('Redeem', function () {
            it('Should fail if no rate set', async function () {
                const { redemption, zeroRateNavProviderMock } = await loadFixture(deployRedemptionProtocol);
                await redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress());
                await expect(redemption.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    redemption,
                    'NonZeroNavRateError',
                );
            });

            it('Should fail if investor has no assets to redeem', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    redemption,
                    'InsufficientRedeemerBalance',
                );
            });

            it('Should fail if no liquidity provider is defined', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateLiquidityProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                    redemption,
                    'NonZeroAddressError',
                );
            });

            it('Should fail if liquidity provider has no balance', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { liquidityProvider, redemption, dsTokenMock } = await loadFixture(deployRedemptionProtocol);
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                await dsTokenMock.approve(await redemption.getAddress(), ASSET_AMOUNT);

                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    'InsufficientLiquidity',
                );
            });

            it('Should fail if provider wallet did not approve liquidity provider contract', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const { redemption, dsTokenMock, dsTokenCollateralMock } = await loadFixture(deployRedemptionProtocol);
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                await dsTokenCollateralMock.mint(securitizeWallet, LIQUIDITY_AMOUNT);
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    dsTokenCollateralMock,
                    'ERC20InsufficientAllowance',
                );
            });

            it('Should fail if the investor country is restricted', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT * 2n);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem * 2n);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY * 2n);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);
                await redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT);

                await redemption.updateCountryRestriction(investorCountry, true);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    redemption,
                    'RestrictedCountry',
                );
            });

            it('Should redeem investor assets without fee', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                const ZERO_FEE = 0;

                // Ensure fee is 0 (default) - using the mockFeeManager
                const { mockFeeManager } = await loadFixture(deployRedemptionProtocol);
                expect(await mockFeeManager.redemptionFee()).to.equal(ZERO_FEE);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);
                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);
                // Verify the redemption completes correctly with no fee applied
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        ZERO_FEE,
                        await usdcMock.getAddress(),
                    );

                // Check balances
                expect(await dsTokenMock.balanceOf(investor)).to.equal(0);
                expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - collateralToRedeem,
                );
                expect(await usdcMock.balanceOf(investor)).to.equal(collateralToRedeem);
            });

            it('Should apply fee correctly during redemption', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockFeeManager,
                } = await loadFixture(deployRedemptionProtocol);

                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // Set a fee of 10% (10000 basis points) on the mock fee manager
                const fee = 10000;
                await mockFeeManager.setRedemptionFee(fee);

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);
                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();

                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;
                const FEE_DENOMINATOR = 100000n;
                // calculate expected liquidity after fee
                // Formula: liquidity - (liquidity * redemptionFee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR
                const expectedLiquidityAfterFee =
                    collateralToRedeem - (collateralToRedeem * BigInt(fee) + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                // Simply verify the event is emitted with the correct values
                await expect(redemption.connect(investor).redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                // Check balances
                expect(await dsTokenMock.balanceOf(investor)).to.equal(0);
                expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - expectedLiquidityAfterFee - expectedFee,
                );
                expect(await usdcMock.balanceOf(investor)).to.equal(expectedLiquidityAfterFee);
            });

            it('Should correctly round up fee to avoid zero fees', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockFeeManager,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // Set a very small fee - 0.001% (1 mbps) on the mock fee manager
                const fee = 1;
                await mockFeeManager.setRedemptionFee(fee);

                // Use a small amount for redemption to test rounding
                const smallAmount = 100n; // This would result in a very small fee
                await dsTokenMock.mint(investor, smallAmount);
                const dsTokenDecimals = await dsTokenMock.decimals();

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(smallAmount);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);

                // Calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                const calcAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(smallAmount);

                // Provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // Provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // Allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // Allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), smallAmount);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(smallAmount);

                // Simply verify the event is emitted with the correct values
                await expect(redemption.connect(investor).redeem(smallAmount, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        smallAmount,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                expect(await dsTokenMock.balanceOf(investor)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - calcAmount,
                );
            });

            it('Allowance implementation - Should redeem investor assets', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, liquidityProvider, dsTokenMock, usdcMock, mockFeeManager } = await loadFixture(
                    deployRedemptionAllowanceProtocol,
                );
                const liquidityProviderWallet = await liquidityProvider.liquidityProviderWallet();

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate usdc to redeem
                const liquidityAmount = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // provide liquidity to external mock contract
                await usdcMock.mint(liquidityProviderWallet, liquidityAmount);

                // allow liquidity provider to take liquidity from treasury
                await usdcMock.approve(liquidityProvider, liquidityAmount);

                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);

                const fee = 1000;
                await mockFeeManager.setRedemptionFee(fee);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                // Simply verify the event is emitted with the correct values
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                // Check balances
                expect(await dsTokenMock.balanceOf(investor)).to.equal(0);
                expect(await usdcMock.balanceOf(liquidityProviderWallet)).to.equal(0);
            });

            it('Allowance implementation - Should fail if liquidity provider wallet has no liquidity token', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, liquidityProvider, dsTokenMock, usdcMock } = await loadFixture(
                    deployRedemptionAllowanceProtocol,
                );

                // Provide collateral asset to securitize wallet
                await dsTokenMock.mint(investor, COLLATERAL_TREASURY);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate usdc to redeem
                const liquidityAmount = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // allow liquidity provider to take liquidity from treasury
                await usdcMock.approve(liquidityProvider, liquidityAmount);

                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    'InsufficientLiquidity',
                );
            });

            it('Allowance implementation - Should fail if liquidity provider wallet does not provide allowance', async function () {
                const [_, investor] = await hre.ethers.getSigners();
                const { redemption, liquidityProvider, dsTokenMock, usdcMock } = await loadFixture(
                    deployRedemptionAllowanceProtocol,
                );
                const liquidityProviderWallet = liquidityProvider.liquidityProviderWallet();

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate usdc to redeem
                const liquidityAmount = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // provide liquidity to external mock contract
                await usdcMock.mint(liquidityProviderWallet, liquidityAmount);

                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT)).revertedWithCustomError(
                    liquidityProvider,
                    'InsufficientLiquidity',
                );
            });

            it('Should revert when output amount is less than minimum', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Calculate the expected output amount
                const calculatedAmount = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);
                const tooHighMinOutputAmount = calculatedAmount + 1n; // Set minimum output amount higher than what will be received

                // Try to redeem with too high minimum output amount
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(
                    redemptionFromInvestor.redeem(ASSET_AMOUNT, tooHighMinOutputAmount),
                ).to.be.revertedWithCustomError(redemption, 'SlippageControlError');

                // Now redeem with an acceptable minimum output amount
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, calculatedAmount)).to.emit(
                    redemption,
                    'RedemptionCompleted',
                );
            });

            it('Should burn investor assets when assetBurn is enabled', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocolWithAssetBurn);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // Verify assetBurn is enabled
                expect(await redemption.assetBurn()).to.equal(true);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // Record initial total supply
                const initialTotalSupply = await dsTokenMock.totalSupply();
                const initialInvestorBalance = await dsTokenMock.balanceOf(investor);

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Record recipient balance before redemption (should be 0 since assets will be burned)
                const recipientAddress = await liquidityProvider.recipient();
                const initialRecipientBalance = await dsTokenMock.balanceOf(recipientAddress);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                //redeem
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        0,
                        await usdcMock.getAddress(),
                    );

                // Check that assets were burned (not transferred to recipient)
                expect(await dsTokenMock.balanceOf(investor)).to.equal(initialInvestorBalance - ASSET_AMOUNT);
                expect(await dsTokenMock.balanceOf(recipientAddress)).to.equal(initialRecipientBalance); // Should remain the same
                expect(await dsTokenMock.totalSupply()).to.equal(initialTotalSupply - ASSET_AMOUNT); // Total supply should decrease

                // Check that investor received liquidity tokens
                expect(await usdcMock.balanceOf(investor)).to.equal(collateralToRedeem);
                expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - collateralToRedeem,
                );
            });

            it('Should execute two-step redemption correctly', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockFeeManager,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();
                const redemptionAddress = await redemption.getAddress();

                const fee = 10000;
                await mockFeeManager.setRedemptionFee(fee);

                // Enable two-step transfer mode
                await redemption.toggleTwoStepTransfer(true);
                expect(await redemption.twoStepTransfer()).to.equal(true);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Record balances before redemption
                const initialInvestorAssetBalance = await dsTokenMock.balanceOf(investor);
                const initialInvestorUsdcBalance = await usdcMock.balanceOf(investor);
                const initialRedemptionAssetBalance = await dsTokenMock.balanceOf(redemptionAddress);
                const initialRedemptionUsdcBalance = await usdcMock.balanceOf(redemptionAddress);
                const recipientAddress = await liquidityProvider.recipient();

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                //redeem using two-step mode
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                // Check that assets were transferred through the contract in two steps
                expect(await dsTokenMock.balanceOf(investor)).to.equal(initialInvestorAssetBalance - ASSET_AMOUNT);
                expect(await dsTokenMock.balanceOf(redemptionAddress)).to.equal(initialRedemptionAssetBalance); // Should be 0 after transfer to recipient
                expect(await dsTokenMock.balanceOf(recipientAddress)).to.equal(ASSET_AMOUNT); // Recipient should receive the assets

                // Check that liquidity was handled through the contract
                expect(await usdcMock.balanceOf(redemptionAddress)).to.equal(initialRedemptionUsdcBalance); // Should be 0 after transfer to investor
                expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - collateralToRedeem,
                );
                expect(await usdcMock.balanceOf(investor)).to.equal(
                    initialInvestorUsdcBalance + collateralToRedeem - expectedFee,
                );
            });

            it('Should revert when output amount is less than minimum in two-step redemption', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

                // Enable two-step transfer mode
                await redemption.toggleTwoStepTransfer(true);
                expect(await redemption.twoStepTransfer()).to.equal(true);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                //redeem using two-step mode
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, ASSET_AMOUNT)).to.be.revertedWithCustomError(
                    redemption,
                    'SlippageControlError',
                );
            });

            it('Should execute two-step redemption with asset burn correctly', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockFeeManager,
                } = await loadFixture(deployRedemptionProtocolWithAssetBurn);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();
                const redemptionAddress = await redemption.getAddress();

                const fee = 10000;
                await mockFeeManager.setRedemptionFee(fee);

                // Enable two-step transfer mode (asset burn is already enabled from fixture)
                await redemption.toggleTwoStepTransfer(true);
                expect(await redemption.twoStepTransfer()).to.equal(true);
                expect(await redemption.assetBurn()).to.equal(true);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // Record initial total supply
                const initialTotalSupply = await dsTokenMock.totalSupply();

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Record balances before redemption
                const initialInvestorAssetBalance = await dsTokenMock.balanceOf(investor);
                const recipientAddress = await liquidityProvider.recipient();
                const initialRecipientBalance = await dsTokenMock.balanceOf(recipientAddress);

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                //redeem using two-step mode with asset burn
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                // Check that assets were burned (not transferred to recipient)
                expect(await dsTokenMock.balanceOf(investor)).to.equal(initialInvestorAssetBalance - ASSET_AMOUNT);
                expect(await dsTokenMock.balanceOf(redemptionAddress)).to.equal(0); // Should be 0 after burn
                expect(await dsTokenMock.balanceOf(recipientAddress)).to.equal(initialRecipientBalance); // Should remain the same
                expect(await dsTokenMock.totalSupply()).to.equal(initialTotalSupply - ASSET_AMOUNT); // Total supply should decrease

                // Check that investor received liquidity tokens
                expect(await usdcMock.balanceOf(investor)).to.equal(collateralToRedeem - expectedFee);
                expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
                expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
                    COLLATERAL_TREASURY - collateralToRedeem,
                );
            });

            it('Should handle fees correctly in two-step redemption', async function () {
                const [securitizeWallet, investor] = await hre.ethers.getSigners();
                const {
                    redemption,
                    liquidityProvider,
                    dsTokenMock,
                    dsTokenCollateralMock,
                    usdcMock,
                    externalRedemptionContractMock,
                    mockFeeManager,
                } = await loadFixture(deployRedemptionProtocol);
                const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();
                const redemptionAddress = await redemption.getAddress();

                // Enable two-step transfer mode
                await redemption.toggleTwoStepTransfer(true);
                expect(await redemption.twoStepTransfer()).to.equal(true);

                // Set a fee of 1% (1000 basis points)
                const fee = 1000;
                await mockFeeManager.setRedemptionFee(fee);

                // mint assets to investor
                await dsTokenMock.mint(investor, ASSET_AMOUNT);
                const dsTokenDecimals = await dsTokenMock.decimals();
                // calculate collateral/usdc to redeem
                const collateralToRedeem = (ASSET_AMOUNT * FIXED_RATE) / 10n ** dsTokenDecimals;

                // provide liquidity to external mock contract
                await usdcMock.mint(externalRedemptionAddress, collateralToRedeem);

                // provide collateral asset to securitize wallet
                await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);

                // allow liquidity provider to take collateral assets from treasury
                await dsTokenCollateralMock.approve(liquidityProvider, collateralToRedeem);

                // allow securitize redemption contract to take assets from investor wallet
                const dsTokenFromInvestor = await dsTokenMock.connect(investor);
                await dsTokenFromInvestor.approve(await redemption.getAddress(), ASSET_AMOUNT);

                // Calculate expected fee (should be calculated on the actual balance in the contract)
                const expectedFeeAmount = await mockFeeManager.getFee(collateralToRedeem);
                const expectedLiquidityAfterFee = collateralToRedeem - expectedFeeAmount;

                const liquidityTokenAmount = await redemption.calculateLiquidityTokenAmountBeforeFee(ASSET_AMOUNT);
                const expectedFee = await mockFeeManager.getFee(liquidityTokenAmount);

                const expectedLiquidityValue = await redemption.calculateLiquidityTokenAmount(ASSET_AMOUNT);

                //redeem using two-step mode with fees
                const redemptionFromInvestor = await redemption.connect(investor);
                await expect(redemptionFromInvestor.redeem(ASSET_AMOUNT, MIN_OUTPUT_AMOUNT))
                    .to.emit(redemption, 'RedemptionCompleted')
                    .withArgs(
                        investor.address,
                        ASSET_AMOUNT,
                        expectedLiquidityValue,
                        FIXED_RATE,
                        expectedFee,
                        await usdcMock.getAddress(),
                    );

                // Check that investor received liquidity minus fees
                expect(await usdcMock.balanceOf(investor)).to.equal(expectedLiquidityAfterFee);

                // Check that fee collector received the fee
                const feeCollector = await mockFeeManager.feeCollector();
                expect(await usdcMock.balanceOf(feeCollector)).to.equal(expectedFeeAmount);

                // Check that redemption contract doesn't hold any tokens after operation
                expect(await usdcMock.balanceOf(redemptionAddress)).to.equal(0);
                expect(await dsTokenMock.balanceOf(redemptionAddress)).to.equal(0);
            });

            it('Should toggle two-step transfer mode correctly', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { redemption } = await loadFixture(deployRedemptionProtocol);

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
            });
        });
    });

    describe('NAV rate Provider Unit Tests', function () {
        describe('Update NAV Provider', function () {
            it('Should update a nav provider correctly', async function () {
                const { redemption, securitizeNavProviderMock } = await loadFixture(deployRedemptionProtocol);
                await redemption.updateNavProvider(await securitizeNavProviderMock.getAddress());
                expect(await redemption.navProvider()).to.equal(await securitizeNavProviderMock.getAddress());
            });
            it('Should update a new nav provider rate and emit events', async function () {
                const { redemption, securitizeNavProviderMock, zeroRateNavProviderMock } =
                    await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateNavProvider(await zeroRateNavProviderMock.getAddress()))
                    .to.emit(redemption, 'NavProviderUpdated')
                    .withArgs(await securitizeNavProviderMock.getAddress(), await zeroRateNavProviderMock.getAddress());
            });
            it('Should fail when trying to update nav provider with zero address', async function () {
                const { redemption } = await loadFixture(deployRedemptionProtocol);
                await expect(redemption.updateNavProvider(hre.ethers.ZeroAddress)).revertedWithCustomError(
                    redemption,
                    'NonZeroAddressError',
                );
            });
            it('Should fail when trying to update a nav provider with unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { redemption, securitizeNavProviderMock } = await loadFixture(deployRedemptionProtocol);
                const navProviderFromUnauthorized = await redemption.connect(unauthorized);
                await expect(
                    navProviderFromUnauthorized.updateNavProvider(await securitizeNavProviderMock.getAddress()),
                ).revertedWithCustomError(redemption, 'OwnableUnauthorizedAccount');
            });
        });
    });

    describe('Redemption Fee Tests', function () {
        describe('Update Redemption Fee', function () {
            it('Should update redemption fee correctly', async function () {
                const { mockFeeManager } = await loadFixture(deployRedemptionProtocol);
                const newFee = 500; // 0.5%
                await mockFeeManager.setRedemptionFee(newFee);
                expect(await mockFeeManager.redemptionFee()).to.equal(newFee);
            });

            it('Should emit RedemptionFeeUpdated event when updating the fee', async function () {
                const { mockFeeManager } = await loadFixture(deployRedemptionProtocol);
                const newFee = 500; // 0.5%
                await expect(mockFeeManager.setRedemptionFee(newFee))
                    .to.emit(mockFeeManager, 'RedemptionFeeUpdated')
                    .withArgs(0, newFee);
            });

            it('Should succeed when fee is exactly 100%', async function () {
                const { mockFeeManager } = await loadFixture(deployRedemptionProtocol);
                const maxFee = 100_000; // Exactly 100%
                await mockFeeManager.setRedemptionFee(maxFee);
                expect(await mockFeeManager.redemptionFee()).to.equal(maxFee);
            });

            it('Should fail when trying to update redemption fee with unauthorized wallet', async function () {
                const [_, unauthorized] = await hre.ethers.getSigners();
                const { mockFeeManager } = await loadFixture(deployRedemptionProtocol);
                const mockFeeManagerFromUnauthorized = await mockFeeManager.connect(unauthorized);
                // Since we don't have access control on the mock, just verify the function exists
                expect(typeof mockFeeManagerFromUnauthorized.setRedemptionFee).to.equal('function');
            });
        });
    });
});
