import hre from 'hardhat';

export const FIXED_RATE = 2000000n;
export const ASSET_AMOUNT = 10000000n;
export const COLLATERAL_TREASURY = 100000000000000000000n;
export const MIN_OUTPUT_AMOUNT = 0n; // Default minimum output amount for testing
export const investorId = 'investorId';
export const investorCountry = 'AR';
export const restrictedCountry = 'BR';
export const invalidCountryCode1 = 'A';
export const invalidCountryCode2 = 'AAAA';
export const invalidCountryCode3 = 'ar';
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;

export const deployRedemptionProtocol = async () => {
    const [securitizeWallet, investor] = await hre.ethers.getSigners();

    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();

    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    // Set up a mock trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const dsTokenCollateralMock = await hre.ethers.deployContract('MockDSToken', [
        'Token2',
        'TK2',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const dsTokenOtherCollateralMock = await hre.ethers.deployContract('MockDSToken', [
        'Other-Token1',
        'Other-TK2',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    const daiMock = await hre.ethers.deployContract('MockERC20', ['DAI', 'DAI', 6]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);

    const mockAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
        await usdcMock.getAddress(),
        await dsTokenMock.getAddress(),
        await externalRedemptionContractMock.getAddress(),
    ]);
    await externalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

    const newExternalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);
    await newExternalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

    const newExternalRedemptionContractDaiMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await daiMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);

    const mockDaiAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
        await daiMock.getAddress(),
        await dsTokenMock.getAddress(),
        await externalRedemptionContractMock.getAddress(),
    ]);
    await newExternalRedemptionContractDaiMock.updateLiquidityProvider(mockDaiAllowanceLiquidityProvider.getAddress());

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const contracts = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(), // Use mock fee manager for testing
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        externalCollateralRedemption: await externalRedemptionContractMock.getAddress(),
        silenceLogs: true,
    });

    return {
        ...contracts,
        dsTokenMock,
        dsTokenCollateralMock,
        usdcMock,
        externalRedemptionContractMock,
        securitizeNavProviderMock,
        zeroRateNavProviderMock,
        mockFeeManager,
        collateralProviderAddressMock: securitizeWallet.address,
        newExternalRedemptionContractMock,
        newExternalRedemptionContractDaiMock,
        mockRegistryService,
    };
};

export const deployRedemptionProtocolWithMultipleTokens = async () => {
    const [securitizeWallet, investor] = await hre.ethers.getSigners();

    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();

    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    // Set up a mock trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        18,
        registryServiceAddress,
        trustServiceAddress,
    ]);

    const dsTokenCollateralMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK2',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);

    const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenCollateralMock.getAddress(), // The asset
        await usdcMock.getAddress(), // The liquidity token
        0,
        await securitizeNavProviderMock.getAddress(), // The NAV provider
    ]);

    const mockAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
        await usdcMock.getAddress(),
        await dsTokenMock.getAddress(),
        await externalRedemptionContractMock.getAddress(),
    ]);
    await externalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const contractsWith18DecimalsDsToken = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        externalCollateralRedemption: await externalRedemptionContractMock.getAddress(),
        silenceLogs: true,
    });

    return {
        dsTokenCollateralMock,
        usdcMock,
        externalRedemptionContractMock,
        securitizeNavProviderMock,
        collateralProviderAddressMock: securitizeWallet.address,
        contractsWith18DecimalsDsTokenMock: contractsWith18DecimalsDsToken,
    };
};

export const deployRedemptionAllowanceProtocol = async () => {
    // Set up a mock Registry Service
    const [securitizeWallet, investor] = await hre.ethers.getSigners();

    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();

    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);
    // Set up a mock trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const contracts = await hre.run('deploy-redemption-allowance-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(), // Use mock fee manager for testing
        assetBurn: 'false', // Default to not burning assets
        recipient: securitizeWallet.address,
        liquidityToken: await usdcMock.getAddress(),
        providerWallet: securitizeWallet.address,
        silenceLogs: true,
    });

    return {
        ...contracts,
        dsTokenMock,
        usdcMock,
        securitizeNavProviderMock,
        mockFeeManager,
        collateralProviderAddressMock: securitizeWallet.address,
    };
};

export const deployRedemptionProtocolWithAssetBurn = async () => {
    // Set up a mock Registry Service
    const [securitizeWallet, investor] = await hre.ethers.getSigners();

    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();

    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    // Set up a mock trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const dsTokenCollateralMock = await hre.ethers.deployContract('MockDSToken', [
        'Token2',
        'TK2',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const dsTokenOtherCollateralMock = await hre.ethers.deployContract('MockDSToken', [
        'Other-Token1',
        'Other-TK2',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    const daiMock = await hre.ethers.deployContract('MockERC20', ['DAI', 'DAI', 6]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);

    const mockAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
        await usdcMock.getAddress(),
        await dsTokenMock.getAddress(),
        await externalRedemptionContractMock.getAddress(),
    ]);
    await externalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

    const newExternalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);
    await newExternalRedemptionContractMock.updateLiquidityProvider(mockAllowanceLiquidityProvider.getAddress());

    const newExternalRedemptionContractDaiMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await daiMock.getAddress(),
        0,
        await securitizeNavProviderMock.getAddress(),
    ]);

    const mockDaiAllowanceLiquidityProvider = await hre.ethers.deployContract('MockAllowanceLiquidityProvider', [
        await daiMock.getAddress(),
        await dsTokenMock.getAddress(),
        await newExternalRedemptionContractDaiMock.getAddress(),
    ]);
    await newExternalRedemptionContractDaiMock.updateLiquidityProvider(mockDaiAllowanceLiquidityProvider.getAddress());

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const contracts = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(), // Use mock fee manager for testing
        assetBurn: 'true', // Enable asset burning
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        externalCollateralRedemption: await externalRedemptionContractMock.getAddress(),
        silenceLogs: true,
    });

    return {
        ...contracts,
        dsTokenMock,
        usdcMock,
        dsTokenCollateralMock,
        dsTokenOtherCollateralMock,
        externalRedemptionContractMock,
        newExternalRedemptionContractMock,
        newExternalRedemptionContractDaiMock,
        securitizeNavProviderMock,
        zeroRateNavProviderMock,
        mockFeeManager,
        daiMock,
        mockAllowanceLiquidityProvider,
        mockDaiAllowanceLiquidityProvider,
        collateralProviderAddressMock: securitizeWallet.address,
        mockRegistryService,
    };
};
