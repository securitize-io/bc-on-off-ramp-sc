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
 * Deploys the token/NAV/fee mocks shared by every on-ramp external-asset-provider fixture.
 * The external provider (Grove Basin pool or PSM adapter) is deployed by the caller, which then
 * wires the protocol through {runDeployOnRampTask}.
 */
const deploySharedMocks = async (assetDecimals: number, liquidityDecimals: number, feeNumerator: bigint) => {
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

    return {
        dsTokenMock,
        usdcMock,
        navProviderMock,
        zeroRateNavProviderMock,
        feeManagerMock,
        mockRegistryService,
        securitizeWallet,
        investor,
        stranger,
    };
};

/**
 * Runs the deploy-on-ramp-external-asset-provider task against an already-deployed external provider.
 * The task also enables investor subscription, so callers must not toggle it again (SameValueError).
 */
const runDeployOnRampTask = async (
    mocks: Awaited<ReturnType<typeof deploySharedMocks>>,
    externalProviderAddress: string,
    singleStep: boolean,
    adminAddress?: string,
) =>
    hre.run('deploy-on-ramp-external-asset-provider', {
        asset: await mocks.dsTokenMock.getAddress(),
        liquidityToken: await mocks.usdcMock.getAddress(),
        navProvider: await mocks.navProviderMock.getAddress(),
        feeManager: await mocks.feeManagerMock.getAddress(),
        groveBasin: externalProviderAddress,
        singleStep,
        ...(adminAddress !== undefined ? { admin: adminAddress } : {}),
        silenceLogs: true,
    });

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
    adminAddress?: string,
) => {
    const mocks = await deploySharedMocks(assetDecimals, liquidityDecimals, feeNumerator);

    // External provider: a PSM adapter, the production counterparty shape for the on-ramp. A plain
    // MockGroveBasin cannot be wired here — like the real Grove Basin (PSM3) pool it models, it does
    // not expose IPSMAdapter.availableAsset() and the provider rejects it at wiring time.
    //
    // Token wiring: collateralToken = USDC, creditToken = DSToken, pocket = address(this). The send
    // custodian is left at its default (`address(this)`), so the adapter self-custodies the asset and
    // {prepareSwap} funds it directly; capacity is still reported through `availableAsset()` and is
    // therefore decoupled from that balance. The external-custodian topology (adapter with zero
    // inventory) is covered by {deployOnRampExternalAssetProviderWithPsmAdapter}.
    const groveBasinMock = await hre.ethers.deployContract('MockPSMAdapter', [await mocks.usdcMock.getAddress()]);
    await groveBasinMock.setCreditToken(await mocks.dsTokenMock.getAddress());

    const { onRamp, assetProvider } = await runDeployOnRampTask(
        mocks,
        await groveBasinMock.getAddress(),
        singleStep,
        adminAddress,
    );

    return { onRamp, assetProvider, adminAddress, groveBasinMock, ...mocks };
};

/**
 * Deploys the on-ramp protocol handing DEFAULT_ADMIN_ROLE to a dedicated admin signer.
 * The deployer (signer[0]) grants the role to `admin` and then renounces its own, so after
 * deployment `admin` must be the sole holder of DEFAULT_ADMIN_ROLE on both contracts.
 */
export const deployOnRampExternalAssetProviderWithAdmin = async () => {
    const signers = await hre.ethers.getSigners();
    const admin = signers[3];
    const deployer = signers[0];
    const ctx = await deployOnRampExternalAssetProvider(6, 6, 0n, false, admin.address);
    return { ...ctx, admin, deployer };
};

export const deployOnRampExternalAssetProvider6x18 = () => deployOnRampExternalAssetProvider(6, 18);
export const deployOnRampExternalAssetProvider18x6 = () => deployOnRampExternalAssetProvider(18, 6);
export const deployOnRampExternalAssetProviderSingleStep = () => deployOnRampExternalAssetProvider(6, 6, 0n, true);

/**
 * Deploys the on-ramp protocol wired to a MockPSMAdapter as the external provider, reproducing the
 * production topology behind BC-2323: the adapter fronts a PSM, holds NO asset inventory of its own
 * (the asset is pulled from `assetCustodian` on delivery) and reports its deliverable capacity
 * through `availableAsset()`.
 *
 * Capacity starts at zero — use {prepareSwapViaAdapter} (or `psmAdapterMock.setAvailableAsset`) to
 * configure what the adapter reports.
 */
export const deployOnRampExternalAssetProviderWithPsmAdapter = async (
    assetDecimals = 6,
    liquidityDecimals = 6,
    feeNumerator = 0n,
    singleStep = false,
) => {
    const mocks = await deploySharedMocks(assetDecimals, liquidityDecimals, feeNumerator);
    const assetCustodian = (await hre.ethers.getSigners())[4];

    // Adapter mock: same token wiring as the Grove Basin mock (collateralToken = USDC,
    // creditToken = DSToken, pocket = address(this)) so the provider's wiring validation passes,
    // but the asset is delivered from an external send custodian instead of the adapter's balance.
    const psmAdapterMock = await hre.ethers.deployContract('MockPSMAdapter', [await mocks.usdcMock.getAddress()]);
    await psmAdapterMock.setCreditToken(await mocks.dsTokenMock.getAddress());
    await psmAdapterMock.setAssetSendCustodian(assetCustodian.address);

    const { onRamp, assetProvider } = await runDeployOnRampTask(
        mocks,
        await psmAdapterMock.getAddress(),
        singleStep,
        undefined,
    );

    return { onRamp, assetProvider, psmAdapterMock, assetCustodian, ...mocks };
};

export const deployOnRampExternalAssetProviderWithPsmAdapterSingleStep = () =>
    deployOnRampExternalAssetProviderWithPsmAdapter(6, 6, 0n, true);

/**
 * Prepares state for a swap call:
 *   - mints `liquidityAmount` USDC to the investor and approves the on-ramp
 *   - mints `assetToFund` (defaults to the gross 1:1 asset output) DSToken into the external provider
 *   - reports the same amount as the provider's `availableAsset()` capacity, so the liquidity gate in
 *     supplyExactIn sees exactly what was funded
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

    const funded = assetToFund ?? expected;

    await usdcMock.mint(investor.address, liquidityAmount);
    await usdcMock.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);
    await dsTokenMock.mint(await groveBasinMock.getAddress(), funded);
    await groveBasinMock.setAvailableAsset(funded);

    return { fee, net, expected };
};

/**
 * PSM-adapter analog of {prepareSwap}:
 *   - mints `liquidityAmount` USDC to the investor and approves the on-ramp
 *   - funds the adapter's send custodian with `assetToFund` (defaults to the 1:1 asset output) and
 *     approves the adapter to pull it — the adapter itself is left with zero inventory
 *   - sets the capacity the adapter reports through `availableAsset()` (defaults to `assetToFund`)
 *
 * Returns the gross/fee/net/expected asset breakdown for assertions.
 */
export const prepareSwapViaAdapter = async (
    ctx: Awaited<ReturnType<typeof deployOnRampExternalAssetProviderWithPsmAdapter>>,
    liquidityAmount: bigint,
    feeNumerator: bigint,
    assetToFund?: bigint,
    reportedAvailable?: bigint,
) => {
    const { onRamp, dsTokenMock, usdcMock, psmAdapterMock, assetCustodian, investor } = ctx;

    const assetDecimals = Number(await dsTokenMock.decimals());
    const liquidityDecimals = Number(await usdcMock.decimals());

    const fee = calcFee(liquidityAmount, feeNumerator);
    const net = liquidityAmount - fee;
    const expected = expectedAsset(net, assetDecimals, liquidityDecimals);
    const funded = assetToFund ?? expected;

    await usdcMock.mint(investor.address, liquidityAmount);
    await usdcMock.connect(investor).approve(await onRamp.getAddress(), liquidityAmount);

    await dsTokenMock.mint(assetCustodian.address, funded);
    await dsTokenMock.connect(assetCustodian).approve(await psmAdapterMock.getAddress(), funded);
    await psmAdapterMock.setAvailableAsset(reportedAvailable ?? funded);

    return { fee, net, expected };
};
