import { task, types } from 'hardhat/config';

export enum AssetProviderType {
  ALLOWANCE,
  MINTING
}

task('deploy-on-ramp', 'Deploy on ramp protocol')
  .addParam('token', 'DS Token address', undefined, types.string, false)
  .addParam('liquidity', 'Liquidity token address', undefined, types.string, false)
  .addParam('nav', 'NAV rate provider address', undefined, types.string, false)
  .addParam('fee', 'Fee Manager address', undefined, types.string, false)
  .addParam('custodian', 'Custodian wallet', undefined, types.string, false)
  .addParam('type', 'Asset provider type', undefined, types.string, false)
  .setAction(async (args, hre) => {
    // On Ramp deployment
    const OnRamp = await hre.ethers.getContractFactory('SecuritizeOnRamp');
    const onRamp = await hre.upgrades.deployProxy(OnRamp, [
      args.token,
      args.liquidity,
      args.nav,
      args.fee,
      args.custodian,
    ]);
    await onRamp.waitForDeployment();

    const onRampAddress = await onRamp.getAddress();
    console.log(`On-Ramp Proxy address: ${onRampAddress}`);

    const onRampImpl = await hre.upgrades.erc1967.getImplementationAddress(onRampAddress);
    console.log(`On-Ramp Implementation address: ${onRampImpl}`);
    //////////////////////////

    // Asset Provider deployment
    let AssetProvider;
    switch (args.type) {
      case AssetProviderType.ALLOWANCE.toString():
        AssetProvider = await hre.ethers.getContractFactory('AllowanceAssetProvider');
        break;
      case AssetProviderType.MINTING.toString():
        AssetProvider = await hre.ethers.getContractFactory('MintingAssetProvider');
        break;
      default:
        throw new Error(`Unsupported type ${args.type}`);
    }
    console.log(`Deploying Asset Provider of type: ${args.type}`);

    const assetProvider = await hre.upgrades.deployProxy(OnRamp, [
      args.token,
      args.liquidity,
      args.nav,
      args.fee,
      args.custodian,
    ]);
    await assetProvider.waitForDeployment();

    const assetProviderAddress = await assetProvider.getAddress();
    console.log(`Asset Provider Proxy address: ${assetProviderAddress}`);

    const assetProviderImpl = await hre.upgrades.erc1967.getImplementationAddress(assetProviderAddress);
    console.log(`Asset Provider Implementation address: ${assetProviderImpl}`);
    //////////////////////////

    // Update asset provider on on-ramp contract
    await onRamp.updateAssetProvider(assetProviderAddress);
    //////////////////////////

    return { onRamp, assetProvider }
  });
