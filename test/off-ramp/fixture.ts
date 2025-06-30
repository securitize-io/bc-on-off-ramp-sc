import hre from 'hardhat';

export const FIXED_RATE = 2000000n;
export const ASSET_AMOUNT = 15n * 10n ** 18n;
export const COLLATERAL_TREASURY = 100000000000000000000n;
export const LIQUIDITY_AMOUNT = 50000000n;
export const MIN_OUTPUT_AMOUNT = 0n; // Default minimum output amount for testing
export const investorCountry = 'AR';
export const restrictedCountry = 'BR';
export const invalidCountryCode = 'A';
export const invalidCountryCode2 = 'AAAA';
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;

export const deployRedemptionProtocol = async () => {
    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy(investorCountry);
    const registryServiceAddress = await mockRegistryService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockERC20', ['Token1', 'TK1', 18, registryServiceAddress]);
    const dsTokenCollateralMock = await hre.ethers.deployContract('MockERC20', [
        'Token1',
        'TK2',
        6,
        registryServiceAddress,
    ]);
    const dsTokenOtherCollateralMock = await hre.ethers.deployContract('MockERC20', [
        'Other-Token1',
        'Other-TK2',
        4,
        registryServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6, registryServiceAddress]);
    const daiMock = await hre.ethers.deployContract('MockERC20', ['DAI', 'DAI', 6, registryServiceAddress]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        await securitizeNavProviderMock.getAddress(),
    ]);
    const newExternalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await usdcMock.getAddress(),
        await securitizeNavProviderMock.getAddress(),
    ]);
    const newExternalRedemptionContractDaiMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenOtherCollateralMock.getAddress(),
        await daiMock.getAddress(),
        await securitizeNavProviderMock.getAddress(),
    ]);

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManager', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector
    const [securitizeWallet] = await hre.ethers.getSigners();

    const contracts = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(), // Use mock fee manager for testing
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        redemption: await externalRedemptionContractMock.getAddress(),
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

export const deployRedemptionAllowanceProtocol = async () => {
    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy(investorCountry);
    const registryServiceAddress = await mockRegistryService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockERC20', ['Token1', 'TK1', 18, registryServiceAddress]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6, registryServiceAddress]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const mockFeeManager = await hre.ethers.deployContract('MockFeeManager', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const [securitizeWallet] = await hre.ethers.getSigners();

    const contracts = await hre.run('deploy-redemption-allowance-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(), // Use mock fee manager for testing
        assetBurn: 'false', // Default to not burning assets
        recipient: securitizeWallet.address,
        liquidityToken: await usdcMock.getAddress(),
        providerWallet: securitizeWallet.address,
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

export const deployRedemptionProtocolWithMultipleTokens = async () => {
    // Set up a mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy(investorCountry);
    const registryServiceAddress = await mockRegistryService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockERC20', ['Token1', 'TK1', 18, registryServiceAddress]);
    const dsToken6DecimalMock = await hre.ethers.deployContract('MockERC20', [
        'Token1-6',
        'TK1-6',
        6,
        registryServiceAddress,
    ]);
    const dsToken0DecimalMock = await hre.ethers.deployContract('MockERC20', [
        'Token1-0',
        'TK1-0',
        0,
        registryServiceAddress,
    ]);
    const dsTokenCollateralMock = await hre.ethers.deployContract('MockERC20', [
        'Token1',
        'TK2',
        6,
        registryServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6, registryServiceAddress]);
    const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        FIXED_RATE,
    ]);
    const externalRedemptionContractMock = await hre.ethers.deployContract('MockExternalRedemption', [
        await dsTokenCollateralMock.getAddress(), // The asset
        await usdcMock.getAddress(), // The liquidity token
        await securitizeNavProviderMock.getAddress(), // The NAV provider
    ]);

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManager', [0, FEE_COLLECTOR]); // Initialize with 0 fee and zero address for feeCollector

    const [securitizeWallet] = await hre.ethers.getSigners();

    const contractsWith18DecimalsDsToken = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        redemption: await externalRedemptionContractMock.getAddress(),
    });

    const contractsWith6DecimalsDsToken = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsToken6DecimalMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        redemption: await externalRedemptionContractMock.getAddress(),
    });

    const contractsWith0DecimalsDsToken = await hre.run('deploy-redemption-collateral-protocol', {
        asset: await dsToken0DecimalMock.getAddress(),
        navProvider: await securitizeNavProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        assetBurn: 'false', // Default to not burning assets
        liquidityToken: await usdcMock.getAddress(),
        recipient: securitizeWallet.address,
        providerWallet: securitizeWallet.address,
        redemption: await externalRedemptionContractMock.getAddress(),
    });
    return {
        dsToken18DecimalMock: dsTokenMock,
        dsToken6DecimalMock,
        dsToken0DecimalMock,
        dsTokenCollateralMock,
        usdcMock,
        externalRedemptionContractMock,
        securitizeNavProviderMock,
        collateralProviderAddressMock: securitizeWallet.address,
        contractsWith18DecimalsDsTokenMock: contractsWith18DecimalsDsToken,
        contractsWith6DecimalsDsTokenMock: contractsWith6DecimalsDsToken,
        contractsWith0DecimalsDsTokenMock: contractsWith0DecimalsDsToken,
    };
};
