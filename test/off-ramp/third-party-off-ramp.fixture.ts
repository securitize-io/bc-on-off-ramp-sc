import hre from 'hardhat';

export const investorId = 'investorId';
export const investorCountry = 'AR';
export const restrictedCountry = 'BR';
export const ASSET_AMOUNT = 10_000_000n; // 10 units of a 6-decimals asset
export const MIN_OUTPUT_AMOUNT = 0n;
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;

/**
 * NAV rate that yields a strict 1:1 (decimal-adjusted) conversion for the given asset decimals.
 * TokenCalculator divides the rate by 10^assetDecimals, so rate = 10^assetDecimals => parity.
 */
export const parityRate = (assetDecimals: number) => 10n ** BigInt(assetDecimals);

/**
 * Expected 1:1 (decimal-adjusted) liquidity output for a given asset amount.
 */
export const expectedOutput = (assetAmount: bigint, assetDecimals: number, liquidityDecimals: number) =>
    (assetAmount * 10n ** BigInt(liquidityDecimals)) / 10n ** BigInt(assetDecimals);

export const deployGroveBasinProtocol = async (assetDecimals = 6, liquidityDecimals = 6) => {
    const [securitizeWallet, investor, operator, stranger] = await hre.ethers.getSigners();

    // Registry / trust services
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();
    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    // Tokens
    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'DSToken',
        'DSToken',
        assetDecimals,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', liquidityDecimals]);

    // NAV providers
    const navProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        parityRate(assetDecimals),
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    // Fee manager (fee initialized to zero)
    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]);

    // Grove Basin (swapToken = USDC, pocket defaults to itself so it transfers from its own balance)
    const groveBasinMock = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);

    const { redemption, liquidityProvider } = await hre.run('deploy-third-party-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await navProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        liquidityToken: await usdcMock.getAddress(),
        groveBasin: await groveBasinMock.getAddress(),
        operator: operator.address,
        silenceLogs: true,
    });

    return {
        redemption,
        liquidityProvider,
        dsTokenMock,
        usdcMock,
        navProviderMock,
        zeroRateNavProviderMock,
        mockFeeManager,
        groveBasinMock,
        mockRegistryService,
        securitizeWallet,
        investor,
        operator,
        stranger,
        assetDecimals,
        liquidityDecimals,
    };
};

// Named fixtures for decimal variants (loadFixture requires stable function references).
export const deployGroveBasinProtocol6x18 = () => deployGroveBasinProtocol(6, 18);
export const deployGroveBasinProtocol18x6 = () => deployGroveBasinProtocol(18, 6);

/**
 * Mints the asset to the investor, funds Grove Basin with liquidity, and sets the
 * investor's allowance over the off-ramp so a redemption can be executed.
 */
export const prepareRedemption = async (
    ctx: Awaited<ReturnType<typeof deployGroveBasinProtocol>>,
    assetAmount: bigint = ASSET_AMOUNT,
    liquidityToFund?: bigint,
) => {
    const { redemption, dsTokenMock, usdcMock, groveBasinMock, investor, assetDecimals, liquidityDecimals } = ctx;

    const expected = expectedOutput(assetAmount, assetDecimals, liquidityDecimals);
    const funding = liquidityToFund ?? expected;

    await dsTokenMock.mint(investor.address, assetAmount);
    await usdcMock.mint(await groveBasinMock.getAddress(), funding);
    await dsTokenMock.connect(investor).approve(await redemption.getAddress(), assetAmount);

    return { expected };
};
