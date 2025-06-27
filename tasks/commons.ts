import { task } from 'hardhat/config';

// npx hardhat contract-call --network sepolia --contract-name SecuritizeOffRamp --method assetAddress --contract-address 0x123...
task('contract-call')
    .addParam('contractName', 'The contract to use')
    .addParam('contractAddress', 'The contract address')
    .addParam('method', 'The method name')
    .addFlag('force', 'The method name')
    .addVariadicPositionalParam('params', 'The method params', [])
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        const contract = await hre.ethers.getContractAt(taskArgs.contractName, taskArgs.contractAddress);
        console.log(await contract[taskArgs.method](...taskArgs.params, taskArgs.force ? { gasLimit: 1000000 } : {}));
    });

task('deploy-proxy', 'Deploy a UUPS proxy contract')
    .addParam('contractName', 'The contract to deploy')
    .addVariadicPositionalParam('args', 'The initializer arguments', [])
    .addParam('kind', 'Proxy kind (default: uups)', 'uups')
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        const Contract = await hre.ethers.getContractFactory(taskArgs.contractName);
        const proxy = await hre.upgrades.deployProxy(Contract, taskArgs.args, { kind: taskArgs.kind });
        await proxy.waitForDeployment();
        const proxyAddress = await proxy.getAddress();
        const implAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
        console.log(`${taskArgs.contractName} proxy deployed at: ${proxyAddress}`);
        console.log(`${taskArgs.contractName} implementation at: ${implAddress}`);
        return { proxyAddress, implAddress };
    });

task('deploy-contract', 'General purpose contract deployer')
    .addFlag('verify', 'Should we attempt to verify the contracts')
    .addParam('contractName', 'The contract to use')
    .addVariadicPositionalParam('args', 'The constructor arguments', [])
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        const contractFactory = await hre.ethers.getContractFactory(taskArgs.contractName);
        const contract = await contractFactory.deploy(...taskArgs.args);
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();
        console.log(`${taskArgs.contractName} deployed at: ${contractAddress}`);
        if (taskArgs.verify) {
            try {
                await hre.run('verify:verify', {
                    address: contractAddress,
                    constructorArguments: taskArgs.args,
                });
            } catch (error) {
                console.error(`Verification failed: ${error}`);
            }
        }
        return contract;
    });

task('verify-implementation', 'Verify a proxy implementation contract on Etherscan')
    .addParam('address', 'Implementation contract address')
    .addParam('contractName', 'Contract name')
    .addVariadicPositionalParam('args', 'Constructor arguments', [])
    .setAction(async (taskArgs, hre) => {
        try {
            await hre.run('verify:verify', {
                address: taskArgs.address,
                constructorArguments: taskArgs.args,
                contract: taskArgs.contractName,
            });
            console.log(`Verified implementation: ${taskArgs.contractName} at ${taskArgs.address}`);
        } catch (error) {
            console.error(`Verification failed for ${taskArgs.contractName} at ${taskArgs.address}:`, error);
        }
    });
