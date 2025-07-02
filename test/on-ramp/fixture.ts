import hre from 'hardhat';
import { AssetProviderType } from '../../tasks';

export const HASH = "0x2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";

export const deployOnRampAllowance = async () => {
  // Set up a mock registry Service
  const mockRegistryService = await hre.ethers.deployContract('MockRegistryService', ['AR']);
  const registryServiceAddress = await mockRegistryService.getAddress();

  // Set up a mock trust Service
  const mockTrustService = await hre.ethers.deployContract('MockTrustService', []);
  const trustServiceAddress = await mockTrustService.getAddress();

  // dstoken mock
  const dsTokenMock = await hre.ethers.deployContract('MockDSToken', ['Token1', 'TK1', 18, registryServiceAddress, trustServiceAddress]);
  // usdc mock
  const usdcMock = await hre.ethers.deployContract('MockERC20', ['USDC', 'USDC', 6, registryServiceAddress]);
  // nav mock
  const navMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [1e6]);
  // fee mock
  const feeMock = await hre.ethers.deployContract('MockFeeManager');

  const [owner, custodianWallet, unknownWallet] = await hre.ethers.getSigners();

  const contracts = await hre.run('deploy-on-ramp', {
    token: await dsTokenMock.getAddress(),
    liquidity: await usdcMock.getAddress(),
    nav: await navMock.getAddress(),
    fee: await feeMock.getAddress(),
    custodian: await custodianWallet.getAddress(),
    type: AssetProviderType.ALLOWANCE.toString(),
  });

  return {
    ...contracts,
    dsTokenMock,
    usdcMock,
    navMock,
    owner,
    custodianWallet,
    unknownWallet
  };
};
