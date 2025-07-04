import { task, types } from 'hardhat/config';

task('deploy-mbps-fee-manager', 'Deploy fee manager')
    .addParam('mbps', 'Fee manager mbps config', undefined, types.int, false)
    .addParam('collector', 'Fee collector address', undefined, types.string, false)
    .setAction(async (args, hre) => {
        const FeeManager = await hre.ethers.getContractFactory('MbpsFeeManager');
        const feeManager = await hre.upgrades.deployProxy(FeeManager, [args.mbps, args.collector]);
        await feeManager.waitForDeployment();

        const feeManagerAddress = await feeManager.getAddress();
        console.log(`Fee Manager Proxy address: ${feeManagerAddress}`);

        const feeManagerImpl = await hre.upgrades.erc1967.getImplementationAddress(feeManagerAddress);
        console.log(`Fee Manager Implementation address: ${feeManagerImpl}`);
    });
