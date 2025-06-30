import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleYellow, delay } from '../utils';

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
    .addParam('kind', 'Proxy kind (default: uups)', 'uups')
    .addFlag('verify', 'Should we attempt to verify the contracts')
    .addVariadicPositionalParam('args', 'The initializer arguments', [])
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        console.log('');
        consoleCyan('deploy-proxy task');
        consoleGreen(`Deploying ${taskArgs.contractName} proxy...`);

        const Contract = await hre.ethers.getContractFactory(taskArgs.contractName);
        const argsTypes = taskArgs.args.map((arg: string) => {
            if (arg === 'true' || arg === 'false') {
                return arg === 'true';
            } else {
                return arg;
            }
        });

        const proxy = await hre.upgrades.deployProxy(Contract, argsTypes, { kind: taskArgs.kind });
        await proxy.waitForDeployment();
        const proxyAddress = await proxy.getAddress();
        const implAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

        console.log(`${taskArgs.contractName} proxy deployed at:`);
        consoleYellow(`${proxyAddress}`);
        console.log(`${taskArgs.contractName} implementation at:`);
        consoleYellow(`${implAddress}`);

        if (taskArgs.verify) {
            await hre.run('verify-contract', {
                address: implAddress,
                contractName: taskArgs.contractName,
                args: [],
            });
        }

        return { proxyAddress, implAddress };
    });

task('deploy-contract', 'General purpose contract deployer')
    .addParam('contractName', 'The contract to use')
    .addFlag('verify', 'Should we attempt to verify the contracts')
    .addVariadicPositionalParam('args', 'The constructor arguments', [])
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        console.log('');
        consoleCyan('deploy-contract task');
        const contractFactory = await hre.ethers.getContractFactory(taskArgs.contractName);
        const contract = await contractFactory.deploy(...taskArgs.args);
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();

        console.log(`${taskArgs.contractName} deployed at: ${contractAddress}`);

        if (taskArgs.verify) {
            await hre.run('verify-contract', {
                address: contractAddress,
                contractName: taskArgs.contractName,
                args: [...taskArgs.args],
            });
        }
        return contract;
    });

task('verify-contract', 'Verify a proxy implementation contract on Etherscan')
    .addParam('address', 'Implementation contract address')
    .addParam('contractName', 'Contract name')
    .addVariadicPositionalParam('args', 'Constructor arguments', [])
    .setAction(async (taskArgs, hre) => {
        console.log('');
        consoleCyan('verify-contract task');
        consoleGreen(`Waiting for 40 seconds before verifying...`);

        // Wait for 40 seconds before verification, to ensure the contract is fully deployed
        await delay(40000);
        console.log(
            `Verifying contract ${taskArgs.contractName} at address ${taskArgs.address} on ${hre.network.name}...`,
        );

        try {
            await hre.run('verify:verify', {
                address: taskArgs.address,
                constructorArguments: taskArgs.args,
            });
            consoleGreen('Contract verified successfully:');
        } catch (error) {
            console.error(`Verification failed for ${taskArgs.contractName} at ${taskArgs.address}:`, error);
        }
    });
