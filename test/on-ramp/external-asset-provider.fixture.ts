import hre from 'hardhat';

export const investorId = 'investorId';
export const investorCountry = 'AR';
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;
export const TOLERANCE_DENOMINATOR = 100_000n;
export const DEFAULT_RATE_TOLERANCE = 1_000n;

/** Fee manager precision: 100_000_000 == 100% (six decimal places of percentage). */
export const FEE_DENOMINATOR = 100_000_000n;

/** Fee percentages exercised in fee tests, expressed in {FEE_DENOMINATOR} units. */
export const FEE_CASES = [
    { label: '0%', numerator: 0n },
    { label: '1%', numerator: 1_000_000n },
    { label: '1.666666%', numerator: 1_666_666n },
    { label: '50%', numerator: 50_000_000n },
    { label: '99.999999%', numerator: 99_999_999n },
] as const;

/** Tolerance values exercised in rate-divergence tests. */
export const RATE_DIVERGENCE_TOLERANCES = [
    { label: '1%', tolerance: 1_000n },
    { label: '5.5%', tolerance: 5_500n },
    { label: '50%', tolerance: 50_000n },
    { label: '99.99%', tolerance: 99_990n },
] as const;

/** NAV tolerance band for a given quote and tolerance value. */
export const rateBand = (navQuote: bigint, tolerance: bigint) => ({
    min: (navQuote * (TOLERANCE_DENOMINATOR - tolerance)) / TOLERANCE_DENOMINATOR,
    max: (navQuote * (TOLERANCE_DENOMINATOR + tolerance)) / TOLERANCE_DENOMINATOR,
});

/** Rounding-up fee, mirroring MockConfigurableFeeManager / MbpsFeeManager. */
export const calcFee = (amount: bigint, numerator: bigint) =>
    (amount * numerator + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;

/**
 * NAV rate that yields a strict 1:1 (decimal-adjusted) conversion for the given asset decimals.
 * SecuritizeOnRamp divides by 10^assetDecimals worth of rate, so rate = 10^assetDecimals => parity.
 */
export const parityRate = (assetDecimals: number) => 10n ** BigInt(assetDecimals);

/** Expected 1:1 (decimal-adjusted) asset output for a given net liquidity amount. */
export const expectedAsset = (netLiquidity: bigint, assetDecimals: number, liquidityDecimals: number) =>
    (netLiquidity * 10n ** BigInt(assetDecimals)) / 10n ** BigInt(liquidityDecimals);

/** Configures the mock Grove Basin preview factor relative to a 1:1 decimal-adjusted quote. */
export const setGbPreviewFactor = async (
    groveBasinMock: Awaited<ReturnType<typeof deployOnRampExternalAssetProvider>>['groveBasinMock'],
    numerator: bigint,
    denominator: bigint,
) => {
    await groveBasinMock.setPreviewFactor(numerator, denominator);
    await groveBasinMock.setRedemptionFeeBps(0);
    await groveBasinMock.setOutputFactor(1, 1);
};

/**
 * Deploys SecuritizeOnRamp + ExternalAssetProvider via the
 * deploy-on-ramp-external-asset-provider task with a DSToken-compliant MockDSToken.
 *
 * The on-ramp is wired with custodianWallet == ExternalAssetProvider, investor subscription
 * enabled and a configurable (default 0%) fee manager. Transfer mode defaults to two-step (the
 * task default for RWA compliance); pass `singleStep = true` to exercise the single-step flow.
 */
export const deployOnRampExternalAssetProvider = async (
    assetDecimals = 6,
    liquidityDecimals = 6,
    feeNumerator = 0n,
    singleStep = false,
) => {
    const [securitizeWallet, investor, stranger] = await hre.ethers.getSigners();

    const mockRegistryService = await hre.ethers.deployContract('MockRegistryService', []);
    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();

    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'DSToken',
        'DSToken',
        assetDecimals,
        await mockRegistryService.getAddress(),
        trustServiceAddress,
    ]);
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', liquidityDecimals]);

    // NAV provider: parity rate => 1:1 (decimal-adjusted) liquidity-to-asset before fees.
    const navProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
        parityRate(assetDecimals),
    ]);
    const zeroRateNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', ['0']);

    const feeManagerMock = await hre.ethers.deployContract('MockConfigurableFeeManager', [feeNumerator, FEE_COLLECTOR]);

    // Grove Basin mock: collateralToken = USDC, creditToken = DSToken, pocket = address(this).
    const groveBasinMock = await hre.ethers.deployContract('MockGroveBasin', [await usdcMock.getAddress()]);
    await groveBasinMock.setCreditToken(await dsTokenMock.getAddress());

    const { onRamp, assetProvider } = await hre.run('deploy-on-ramp-external-asset-provider', {
        asset: await dsTokenMock.getAddress(),
        liquidityToken: await usdcMock.getAddress(),
        navProvider: await navProviderMock.getAddress(),
        feeManager: await feeManagerMock.getAddress(),
        groveBasin: await groveBasinMock.getAddress(),
        singleStep,
        silenceLogs: true,
    });

    // The deploy task already enables investor subscription; toggling again would revert
    // (SameValueError), so it is intentionally not repeated here.

    return {
        onRamp,
        assetProvider,
        dsTokenMock,
        usdcMock,
        groveBasinMock,
        navProviderMock,
        zeroRateNavProviderMock,
        feeManagerMock,
        mockRegistryService,
        securitizeWallet,
        investor,
        stranger,
    };
};

export const deployOnRampExternalAssetProvider6x18 = () => deployOnRampExternalAssetProvider(6, 18);
export const deployOnRampExternalAssetProvider18x6 = () => deployOnRampExternalAssetProvider(18, 6);
export const deployOnRampExternalAssetProviderSingleStep = () => deployOnRampExternalAssetProvider(6, 6, 0n, true);

/**
 * Prepares state for a swap call:
 *   - mints `liquidityAmount` USDC to the investor and approves the on-ramp
 *   - mints `assetToFund` (defaults to the gross 1:1 asset output) DSToken into Grove Basin
 *
 * Returns the gross/fee/net/expected asset breakdown for assertions.
 */
export const prepareSwap = async (
    ctx: Awaited<ReturnType<typeof deployOnRampExternalAssetProvider>>,
    liquidityAmount: bigint,
    feeNumerator: bigint,
    assetToFund?: bigint,
) => {
    const { onRamp, dsTokenMock, usdcMock, groveBasinMock, investor } = ctx;

    const assetDecimals = Number(await dsTokenMock.decimals());
    const liquidityDecimals = Number(await usdcMock.decimals());

    const fee = calcFee(liquidityAmount, feeNumerator);
    const net = liquidityAmount - fee;
    const expected = expectedAsset(net, assetDecimals, liquidityDecimals);

    await usdcMock.mint(investor.address, liquidityAmount);
    await usdcMock.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);
    await dsTokenMock.mint(await groveBasinMock.getAddress(), assetToFund ?? expected);

    return { fee, net, expected };
};
