import hre from 'hardhat';
import type { PublicStockOnRamp } from '../../typechain-types/contracts/on-ramp/PublicStockOnRamp';
import type { MintingAssetProvider } from '../../typechain-types/contracts/on-ramp/provider/MintingAssetProvider';
import type { MockDSToken } from '../../typechain-types/contracts/mock/MockDSToken';
import type { MockERC20 } from '../../typechain-types/contracts/mock/MockERC20';
import type { MockSecuritizeAmmNavProvider } from '../../typechain-types/contracts/mock/MockSecuritizeAmmNavProvider';
import type { MockFeeManagerOffRamp } from '../../typechain-types/contracts/off-ramp/mock/MockFeeManagerOffRamp';
import type { MockRegistryService } from '../../typechain-types/contracts/mock/MockRegistryService';
import type { MockTrustService } from '../../typechain-types/contracts/mock/MockTrustService';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

export const FIXED_AMM_PRICE = 2000000n; // 2.0 in base asset decimals (6 decimals for TSLA)
export const LIQUIDITY_AMOUNT = 10000000n; // 10 USDC (6 decimals)
export const MIN_OUT_AMOUNT = 0n;
export const MARKET_STATUS_OPEN = 1;
export const MARKET_STATUS_CLOSED = 0;
export const investorId = 'investorId';
export const investorCountry = 'AR';
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;

/**
 * Deploy PublicStockOnRamp with all necessary dependencies for testing
 */
export const deployPublicStockOnRamp = async (): Promise<{
    onRamp: PublicStockOnRamp;
    assetProvider: MintingAssetProvider;
    dsToken: MockDSToken;
    liquidityToken: MockERC20;
    ammNavProvider: MockSecuritizeAmmNavProvider;
    feeManager: MockFeeManagerOffRamp;
    mockRegistryService: MockRegistryService;
    mockTrustService: MockTrustService;
    owner: HardhatEthersSigner;
    investor: HardhatEthersSigner;
    operator: HardhatEthersSigner;
    custodian: HardhatEthersSigner;
    unauthorized: HardhatEthersSigner;
}> => {
    const [owner, investor, operator, custodian, unauthorized] = await hre.ethers.getSigners();

    // Mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);

    // Mock Trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);

    // Deploy tokens
    const dsToken = await hre.ethers.deployContract('MockDSToken', [
        'TSLA',
        'TSLA',
        6,
        await mockRegistryService.getAddress(),
        await mockTrustService.getAddress(),
    ]);

    const liquidityToken = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);

    // Deploy AMM NAV Provider
    const ammNavProvider = await hre.ethers.deployContract('MockSecuritizeAmmNavProvider', [FIXED_AMM_PRICE]);

    // Deploy Fee Manager with 0 fee
    const feeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]);

    // Deploy PublicStockOnRamp
    const PublicStockOnRamp = await hre.ethers.getContractFactory('PublicStockOnRamp');
    const onRamp = await hre.upgrades.deployProxy(PublicStockOnRamp, [
        await dsToken.getAddress(),
        await liquidityToken.getAddress(),
        await ammNavProvider.getAddress(),
        await feeManager.getAddress(),
        custodian.address,
    ]);

    // Grant OPERATOR_ROLE
    const OPERATOR_ROLE = await onRamp.OPERATOR_ROLE();
    await onRamp.grantRole(OPERATOR_ROLE, operator.address);

    // Deploy Asset Provider (Minting)
    const MintingAssetProvider = await hre.ethers.getContractFactory('MintingAssetProvider');
    const assetProvider = await hre.upgrades.deployProxy(MintingAssetProvider, [
        await dsToken.getAddress(),
        await onRamp.getAddress(),
    ]);

    // Link asset provider
    await onRamp.updateAssetProvider(await assetProvider.getAddress());

    return {
        onRamp: onRamp as unknown as PublicStockOnRamp,
        assetProvider: assetProvider as unknown as MintingAssetProvider,
        dsToken: dsToken as unknown as MockDSToken,
        liquidityToken: liquidityToken as unknown as MockERC20,
        ammNavProvider: ammNavProvider as unknown as MockSecuritizeAmmNavProvider,
        feeManager: feeManager as unknown as MockFeeManagerOffRamp,
        mockRegistryService: mockRegistryService as unknown as MockRegistryService,
        mockTrustService: mockTrustService as unknown as MockTrustService,
        owner,
        investor,
        operator,
        custodian,
        unauthorized,
    };
};
