import hre from 'hardhat';

export const investorId = 'investorId';
export const investorCountry = 'AR';
export const restrictedCountry = 'BR';
export const ASSET_AMOUNT = 10_000_000n; // 10 units of a 6-decimals asset
export const MIN_OUTPUT_AMOUNT = 0n;
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;
export const TOLERANCE_DENOMINATOR = 100_000n;
export const DEFAULT_REDEEM_TOLERANCE = 1_000n;

/** Tolerance values exercised in rate-divergence tests (1%, 5.5%, 50%, 99.99%). */
export const RATE_DIVERGENCE_TOLERANCES = [
    { label: '1%', tolerance: 1_000n },
    { label: '5.5%', tolerance: 5_500n },
    { label: '50%', tolerance: 50_000n },
    { label: '99.99%', tolerance: 99_990n },
] as const;

/**
 * NAV tolerance band for a given gross quote and tolerance value.
 */
export const rateBand = (navGross: bigint, tolerance: bigint) => ({
    min: (navGross * (TOLERANCE_DENOMINATOR - tolerance)) / TOLERANCE_DENOMINATOR,
    max: (navGross * (TOLERANCE_DENOMINATOR + tolerance)) / TOLERANCE_DENOMINATOR,
});

/**
 * Configures the mock Grove Basin preview factor relative to a 1:1 decimal-adjusted quote.
 */
export const setGbPreviewFactor = async (
    groveBasinMock: Awaited<ReturnType<typeof deploySecuritizeGroveBasinProtocol>>['groveBasinMock'],
    numerator: bigint,
    denominator: bigint,
) => {
    await groveBasinMock.setPreviewFactor(numerator, denominator);
    await groveBasinMock.setRedemptionFeeBps(0);
    await groveBasinMock.setOutputFactor(1, 1);
};

/**
 * NAV rate that yields a strict 1:1 (decimal-adjusted) conversion for the given asset decimals.
 * TokenCalculator divides by 10^assetDecimals, so rate = 10^assetDecimals => parity.
 */
export const parityRate = (assetDecimals: number) => 10n ** BigInt(assetDecimals);

/**
 * Expected 1:1 (decimal-adjusted) pre-fee liquidity output for a given asset amount.
 */
export const expectedOutput = (assetAmount: bigint, assetDecimals: number, liquidityDecimals: number) =>
    (assetAmount * 10n ** BigInt(liquidityDecimals)) / 10n ** BigInt(assetDecimals);

/**
 * Deploys SecuritizeOffRamp + ExternalLiquidityProvider via the
 * deploy-redemption-grove-basin-protocol task with a full DSToken-compliant
 * MockDSToken (backed by MockRegistryService + MockTrustService).
 *
 * The deploy task automatically sets twoStepTransfer = true on the off-ramp.
 */
export const deploySecuritizeGroveBasinProtocol = async (assetDecimals = 6, liquidityDecimals = 6) => {
    const [securitizeWallet, investor, stranger] = await hre.ethers.getSigners();

    // Registry and trust services — required for DSToken compliance checks in SecuritizeOffRamp.
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

    // NAV provider: parity rate => 1:1 asset-to-liquidity before fees.
    const navProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        parityRate(assetDecimals),
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    // Fee manager: 0% fee by default; tests that exercise fees call setRedemptionFee().
    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]);

    // Grove Basin mock: collateralToken = USDC, creditToken = DSToken, pocket = address(this) by default.
    const groveBasinMock = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
    await groveBasinMock.setCreditToken(await dsTokenMock.getAddress());

    const contracts = await hre.run('deploy-redemption-grove-basin-protocol', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await navProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        liquidityToken: await usdcMock.getAddress(),
        groveBasin: await groveBasinMock.getAddress(),
        silenceLogs: true,
    });

    return {
        ...contracts,
        dsTokenMock,
        usdcMock,
        groveBasinMock,
        navProviderMock,
        zeroRateNavProviderMock,
        mockFeeManager,
        mockRegistryService,
        securitizeWallet,
        investor,
        stranger,
    };
};

/**
 * Deploys SecuritizeOffRamp + ExternalLiquidityProvider with assetBurn enabled.
 * This is an intentionally misconfigured pairing used to exercise {AssetBurnNotSupported}.
 */
export const deploySecuritizeGroveBasinProtocolWithAssetBurn = async (assetDecimals = 6, liquidityDecimals = 6) => {
    const [securitizeWallet, investor, stranger] = await hre.ethers.getSigners();

    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    const registryServiceAddress = await mockRegistryService.getAddress();
    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'DSToken',
        'DSToken',
        assetDecimals,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', liquidityDecimals]);

    const navProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        parityRate(assetDecimals),
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    const mockFeeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]);

    const groveBasinMock = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
    await groveBasinMock.setCreditToken(await dsTokenMock.getAddress());

    const { redemptionAddress } = await hre.run('deploy-offramp', {
        asset: await dsTokenMock.getAddress(),
        navProvider: await navProviderMock.getAddress(),
        feeManager: await mockFeeManager.getAddress(),
        assetBurn: 'true',
        silenceLogs: true,
    });

    const { liquidityProviderAddress } = await hre.run('deploy-grove-basin-provider', {
        liquidityToken: await usdcMock.getAddress(),
        securitizeOffRamp: redemptionAddress,
        groveBasin: await groveBasinMock.getAddress(),
        silenceLogs: true,
    });

    const redemption = await hre.ethers.getContractAt('SecuritizeOffRamp', redemptionAddress);
    const liquidityProvider = await hre.ethers.getContractAt(
        'ExternalLiquidityProvider',
        liquidityProviderAddress,
    );

    const twoStepTx = await redemption.toggleTwoStepTransfer(true);
    await twoStepTx.wait(1);

    const linkTx = await redemption.updateLiquidityProvider(liquidityProviderAddress);
    await linkTx.wait(1);

    return {
        redemption,
        liquidityProvider,
        dsTokenMock,
        usdcMock,
        groveBasinMock,
        navProviderMock,
        zeroRateNavProviderMock,
        mockFeeManager,
        mockRegistryService,
        securitizeWallet,
        investor,
        stranger,
    };
};

export const deploySecuritizeGroveBasinProtocol6x18 = () => deploySecuritizeGroveBasinProtocol(6, 18);
export const deploySecuritizeGroveBasinProtocol18x6 = () => deploySecuritizeGroveBasinProtocol(18, 6);

/**
 * Prepares state for a redemption call:
 *   - mints assetAmount DSToken to the investor
 *   - mints liquidityToFund (defaults to the pre-fee 1:1 output) USDC into Grove Basin
 *   - approves the off-ramp to spend the investor's asset
 *
 * Returns the pre-fee expected output for assertion purposes.
 * The full pre-fee amount is minted to Grove Basin so the swap can succeed;
 * if a fee is active the off-ramp deducts it from the swap proceeds before forwarding.
 */
export const prepareRedemption = async (
    ctx: Awaited<ReturnType<typeof deploySecuritizeGroveBasinProtocol>>,
    assetAmount: bigint,
    liquidityToFund?: bigint,
) => {
    const { redemption, dsTokenMock, usdcMock, groveBasinMock } = ctx;
    const [, investor] = await hre.ethers.getSigners();

    const assetDecimals = Number(await dsTokenMock.decimals());
    const liquidityDecimals = Number(await usdcMock.decimals());
    const preFeeExpected = expectedOutput(assetAmount, assetDecimals, liquidityDecimals);

    await dsTokenMock.mint(investor.address, assetAmount);
    await usdcMock.mint(await groveBasinMock.getAddress(), liquidityToFund ?? preFeeExpected);
    await dsTokenMock.connect(investor).approve(await redemption.getAddress(), assetAmount);

    return { preFeeExpected };
};
