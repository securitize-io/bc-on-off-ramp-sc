import hre from 'hardhat';
import type { PublicStockOffRamp } from '../../typechain-types/contracts/off-ramp/PublicStockOffRamp';
import type { AllowanceLiquidityProvider } from '../../typechain-types/contracts/off-ramp/provider/AllowanceLiquidityProvider';
import type { MockDSToken } from '../../typechain-types/contracts/mock/MockDSToken';
import type { MockERC20 } from '../../typechain-types/contracts/mock/MockERC20';
import type { MockSecuritizeAmmNavProvider } from '../../typechain-types/contracts/mock/MockSecuritizeAmmNavProvider';
import type { MockFeeManagerOffRamp } from '../../typechain-types/contracts/off-ramp/mock/MockFeeManagerOffRamp';
import type { MockRegistryService } from '../../typechain-types/contracts/mock/MockRegistryService';
import type { MockTrustService } from '../../typechain-types/contracts/mock/MockTrustService';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

export const FIXED_AMM_PRICE = 2000000n; // 2.0 in base asset decimals (6 decimals for TSLA)
export const ASSET_AMOUNT = 10000000n; // 10 TSLA tokens (6 decimals)
export const MIN_OUTPUT_AMOUNT = 0n;
export const MARKET_STATUS_OPEN = 1;
export const MARKET_STATUS_CLOSED = 0;
export const investorId = 'investorId';
export const investorCountry = 'AR';
export const restrictedCountry = 'BR';
export const FEE_COLLECTOR = hre.ethers.Wallet.createRandom().address;

/**
 * Deploy PublicStockOffRamp with all necessary dependencies for testing
 */
export const deployPublicStockOffRamp = async (): Promise<{
    offRamp: PublicStockOffRamp;
    liquidityProvider: AllowanceLiquidityProvider;
    dsToken: MockDSToken;
    liquidityToken: MockERC20;
    ammNavProvider: MockSecuritizeAmmNavProvider;
    feeManager: MockFeeManagerOffRamp;
    mockRegistryService: MockRegistryService;
    mockTrustService: MockTrustService;
    owner: HardhatEthersSigner;
    investor: HardhatEthersSigner;
    operator: HardhatEthersSigner;
    recipient: HardhatEthersSigner;
    unauthorized: HardhatEthersSigner;
}> => {
    const [owner, investor, operator, recipient, unauthorized] = await hre.ethers.getSigners();

    // Mock Registry Service
    const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
    const mockRegistryService = await MockRegistryService.deploy();
    await mockRegistryService.updateInvestor(investorId, '0x', investorCountry, [investor.address], [], [], []);
    // Register operator as investor (required by investorExists modifier)
    await mockRegistryService.updateInvestor('operatorId', '0x', investorCountry, [operator.address], [], [], []);

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

    // Deploy Fee Manager
    const feeManager = await hre.ethers.deployContract('MockFeeManagerOffRamp', [0, FEE_COLLECTOR]);

    // Deploy PublicStockOffRamp
    const PublicStockOffRamp = await hre.ethers.getContractFactory('PublicStockOffRamp');
    const offRamp = await hre.upgrades.deployProxy(PublicStockOffRamp, [
        await dsToken.getAddress(),
        await ammNavProvider.getAddress(),
        await feeManager.getAddress(),
        false, // assetBurn
    ]);

    // Grant OPERATOR_ROLE
    const OPERATOR_ROLE = await offRamp.OPERATOR_ROLE();
    await offRamp.grantRole(OPERATOR_ROLE, operator.address);

    // Deploy Liquidity Provider
    const AllowanceLiquidityProvider = await hre.ethers.getContractFactory('AllowanceLiquidityProvider');
    const liquidityProvider = await hre.upgrades.deployProxy(AllowanceLiquidityProvider, [
        await liquidityToken.getAddress(),
        recipient.address,
        await offRamp.getAddress(),
        owner.address, // provider wallet
    ]);

    // Link liquidity provider
    await offRamp.updateLiquidityProvider(await liquidityProvider.getAddress());

    // Mint tokens to investor
    await dsToken.mint(investor.address, ASSET_AMOUNT * 10n);

    // Approve liquidity for liquidity provider
    // Mint enough liquidity: 10 TSLA * 2 USD/TSLA = 20 USD, so mint 1000 USDC to be safe
    await liquidityToken.mint(owner.address, 100000000000n); // 100,000 USDC (6 decimals)
    await liquidityToken.approve(await liquidityProvider.getAddress(), 100000000000n);

    return {
        offRamp: offRamp as unknown as PublicStockOffRamp,
        liquidityProvider: liquidityProvider as unknown as AllowanceLiquidityProvider,
        dsToken: dsToken as unknown as MockDSToken,
        liquidityToken: liquidityToken as unknown as MockERC20,
        ammNavProvider: ammNavProvider as unknown as MockSecuritizeAmmNavProvider,
        feeManager: feeManager as unknown as MockFeeManagerOffRamp,
        mockRegistryService: mockRegistryService as unknown as MockRegistryService,
        mockTrustService: mockTrustService as unknown as MockTrustService,
        owner,
        investor,
        operator,
        recipient,
        unauthorized,
    };
};
