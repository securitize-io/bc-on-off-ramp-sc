import { task, types } from 'hardhat/config';
import { AssetProviderType } from './types';

task('deploy-public-stock-on-ramp', 'Deploy Public Stock on ramp protocol')
    .addParam('token', 'DS Token address', undefined, types.string, false)
    .addParam('liquidity', 'Liquidity token address', undefined, types.string, false)
    .addParam('nav', 'NAV rate provider address', undefined, types.string, false)
    .addParam('fee', 'Fee Manager address', undefined, types.string, false)
    .addParam('custodian', 'Custodian wallet', undefined, types.string, false)
    .addParam('type', 'Asset provider type', undefined, types.string, false)
    .addParam('provider', 'optional asset provider wallet', undefined, types.string, true)
    .setAction(async (args, hre) => {
        // Public Stock On Ramp deployment
        const OnRamp = await hre.ethers.getContractFactory('PublicStockOnRamp');
        const onRamp = await hre.upgrades.deployProxy(OnRamp, [
            args.token,
            args.liquidity,
            args.nav,
            args.fee,
            args.custodian,
        ]);
        await onRamp.waitForDeployment();

        const onRampAddress = await onRamp.getAddress();
        console.log(`Public Stock On-Ramp Proxy address: ${onRampAddress}`);

        const onRampImpl = await hre.upgrades.erc1967.getImplementationAddress(onRampAddress);
        console.log(`Public Stock On-Ramp Implementation address: ${onRampImpl}`);
        //////////////////////////

        // Asset Provider deployment
        let AssetProvider;
        let assetProvider;
        switch (args.type) {
            case AssetProviderType.ALLOWANCE.toString():
                AssetProvider = await hre.ethers.getContractFactory('AllowanceAssetProvider');
                assetProvider = await hre.upgrades.deployProxy(AssetProvider, [
                    args.token,
                    await onRamp.getAddress(),
                    args.provider,
                ]);
                console.warn(`Please do not forget to approve allowance to assetProvider contract`);
                break;
            case AssetProviderType.MINTING.toString():
                AssetProvider = await hre.ethers.getContractFactory('MintingAssetProvider');
                assetProvider = await hre.upgrades.deployProxy(AssetProvider, [args.token, await onRamp.getAddress()]);
                console.warn(`Please do not forget grant issuer permissions to Minting provider`);
                break;
            default:
                throw new Error(`Unsupported type ${args.type}`);
        }
        console.log(`Deploying Asset Provider of type: ${args.type}`);

        await assetProvider.waitForDeployment();

        const assetProviderAddress = await assetProvider.getAddress();
        console.log(`Asset Provider Proxy address: ${assetProviderAddress}`);

        const assetProviderImpl = await hre.upgrades.erc1967.getImplementationAddress(assetProviderAddress);
        console.log(`Asset Provider Implementation address: ${assetProviderImpl}`);
        //////////////////////////

        // Update asset provider on on-ramp contract
        await onRamp.updateAssetProvider(assetProviderAddress);
        //////////////////////////

        console.log('Please configure add hoc config parameters to align your requirements:');
        console.log('twoStepTransfer - default false');
        console.log('USDCBridge - default 0x');
        console.log('bridgeChainId - default 0');

        return { onRamp, assetProvider };
    });
