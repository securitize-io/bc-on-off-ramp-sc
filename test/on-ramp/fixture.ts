import hre from 'hardhat';
import { AssetProviderType } from '../../tasks';

export const HASH = '0x2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b';

export const deployOnRampAllowance = async () => {
    return deployOnRamp(AssetProviderType.ALLOWANCE);
};

export const deployOnRampMinting = async () => {
    return deployOnRamp(AssetProviderType.MINTING);
};

const deployOnRamp = async (type: AssetProviderType) => {
    const [owner, custodianWallet, feeCollector, assetProviderWallet, unknownWallet, eip712Signer] =
        await hre.ethers.getSigners();
    // Set up a mock registry Service
    const mockRegistryService = await hre.ethers.deployContract('MockRegistryService', []);
    const registryServiceAddress = await mockRegistryService.getAddress();

    // Set up a mock trust Service
    const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
    const trustServiceAddress = await mockTrustService.getAddress();
    await mockTrustService.setRole(await eip712Signer.getAddress(), 4);

    // dstoken mock
    const dsTokenMock = await hre.ethers.deployContract('MockDSToken', [
        'Token1',
        'TK1',
        6,
        registryServiceAddress,
        trustServiceAddress,
    ]);
    // usdc mock
    const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6]);
    // nav mock
    const navMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [1e6]);
    // fee mock
    const feeMock = await hre.ethers.deployContract('MockFeeManager', [feeCollector]);
    // bridge mock
    const bridgeMock = await hre.ethers.deployContract('MockUSDCBridge', [usdcMock]);

    const contracts = await hre.run('deploy-on-ramp', {
        token: await dsTokenMock.getAddress(),
        liquidity: await usdcMock.getAddress(),
        nav: await navMock.getAddress(),
        fee: await feeMock.getAddress(),
        custodian: await custodianWallet.getAddress(),
        type: type.toString(),
        provider: await assetProviderWallet.getAddress(), // only for asset allowance mode
    });

    return {
        ...contracts,
        dsTokenMock,
        usdcMock,
        navMock,
        owner,
        custodianWallet,
        unknownWallet,
        eip712Signer,
        mockTrustService,
        mockRegistryService,
        assetProviderWallet,
        feeCollector,
        bridgeMock,
    };
};
