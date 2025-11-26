import { task } from 'hardhat/config';
import { consoleCyan, consoleGreen, consoleRed, consoleYellow, delay } from '../utils';
import { Wallet } from 'ethers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// npx hardhat contract-call --network sepolia --contract-name RegularOffRamp --method assetAddress --contract-address 0x123...
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
    .addFlag('silenceLogs', 'Verbose output')
    .addFlag('compile', 'Should we compile the contracts')
    .addVariadicPositionalParam('args', 'The initializer arguments', [])
    .setAction(async (taskArgs, hre) => {
        if (taskArgs.compile) {
            await hre.run('compile');
        }

        if (!taskArgs.silenceLogs) {
            consoleCyan('\n task: deploy-proxy');
            consoleGreen(`Deploying ${taskArgs.contractName} proxy...`);
        }

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

        if (!taskArgs.silenceLogs) {
            console.log(`${taskArgs.contractName} proxy deployed at:`);
            consoleYellow(`${proxyAddress}`);
            console.log(`${taskArgs.contractName} implementation at:`);
            consoleYellow(`${implAddress}`);
        }

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
        consoleCyan('\n task: deploy-contract');
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
        consoleCyan('\n task: verify-contract');
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

/*
npx hardhat approve --network sepolia --token 0x123 --owner 0x123 --spender 0x123
*/
task('approve', 'Approve tokens for a spender')
    .addParam('token', 'Stable coin to provide liquidity')
    .addParam('owner', 'Wallet that provides liquidity')
    .addParam('spender', 'Address of the liquidity provider')
    .addOptionalParam('amount', 'Address of the liquidity provider')
    .addOptionalParam('privateKey', 'Private key of the owner wallet')
    .setAction(async (args, hre) => {
        consoleCyan('\n task: approve');
        consoleCyan('Arguments:');
        console.log(`- Token: ${args.token}`);
        console.log(`- Owner: ${args.owner}`);
        console.log(`- Spender: ${args.spender}`);

        const AMOUNT = args.amount ? BigInt(args.amount) : hre.ethers.MaxUint256;

        const token = await hre.ethers.getContractAt('IERC20', args.token);
        let ownerWallet: HardhatEthersSigner | Wallet = await hre.ethers.getSigner(args.owner);
        if (args.privateKey) {
            ownerWallet = new hre.ethers.Wallet(args.privateKey, hre.ethers.provider);
            consoleYellow(`Using private key for owner wallet: ${ownerWallet.address}`);
        } else {
            consoleYellow(`Using signer for owner wallet: ${ownerWallet.address}`);
        }

        const allowance = await token.allowance(ownerWallet.address, args.spender);
        const allowanceBN = BigInt(allowance);

        if (allowanceBN.toString() === '0') {
            // @ts-expect-error approve method is not defined in BaseContract
            const tx = await token.connect(ownerWallet).approve(args.spender, AMOUNT);
            await tx.wait();
            consoleYellow(`Allowance set for ${args.spender}: ${AMOUNT.toString()}`);
        } else {
            if (allowanceBN < AMOUNT) {
                // @ts-expect-error approve method is not defined in BaseContract
                const tx = await token.connect(ownerWallet).approve(args.spender, AMOUNT);
                await tx.wait();
                consoleYellow(`Allowance updated for ${args.spender}: ${AMOUNT.toString()}`);
            } else {
                // Allowance is already set to a value greater than or equal to AMOUNT
                consoleRed(`Allowance already set for ${args.spender}: ${allowance.toString()}`);
            }
        }
    });

task('allowance', 'Approve tokens for a spender')
    .addParam('token', 'Token address')
    .addParam('owner', 'Owner address')
    .addParam('spender', 'Spender address')
    .setAction(async (taskArgs, hre) => {
        consoleCyan('\n task: allowance');
        consoleCyan('Arguments:');
        console.log(`- Token: ${taskArgs.token}`);
        console.log(`- Spender: ${taskArgs.spender}`);

        const token = await hre.ethers.getContractAt('IERC20', taskArgs.token);
        const allowance = await token.allowance(taskArgs.owner, taskArgs.spender);
        consoleGreen(`Allowance: ${allowance.toString()}`);
    });

/*
npx hardhat redeem --network sepolia --redemption-address 0x123 --asset-amount 10000000 --min-output-amount 0
*/
task('redeem', 'Redeem tokens from the RegularOffRamp contract')
    .addParam('redemptionAddress', 'RegularOffRamp contract address')
    .addParam('assetAmount', 'Amount of tokens to redeem')
    .addParam('minOutputAmount', 'Minimum amount of output tokens to receive')
    .addFlag('force', 'Force the redemption even if the amount is zero')
    .setAction(async (taskArgs, hre) => {
        consoleCyan('\n task: redeem');
        consoleCyan('Arguments:');
        console.log(`- Redemption Address: ${taskArgs.redemptionAddress}`);
        console.log(`- Asset Amount: ${taskArgs.assetAmount}`);
        console.log(`- Min Output Amount: ${taskArgs.minOutputAmount}`);

        const redemption = await hre.ethers.getContractAt('RegularOffRamp', taskArgs.redemptionAddress);
        const tx = await redemption.redeem(taskArgs.assetAmount, taskArgs.minOutputAmount, {
            ...(taskArgs.force ? { gasLimit: 1000000 } : {}),
        });
        await tx.wait();

        console.log(`Transaction hash: ${tx.hash}`);
        consoleGreen(`Redeemed ${taskArgs.assetAmount} tokens with min output of ${taskArgs.minOutputAmount}`);
    });

task('balance', 'Check the balance of a token for a given address')
    .addParam('token', 'Token address')
    .addParam('address', 'Address to check balance for')
    .setAction(async (taskArgs, hre) => {
        consoleCyan('\n task: balance');
        consoleCyan('Arguments:');
        console.log(`- Token: ${taskArgs.token}`);
        console.log(`- Address: ${taskArgs.address}`);

        const token = await hre.ethers.getContractAt('IERC20', taskArgs.token);
        const balance = await token.balanceOf(taskArgs.address);
        consoleGreen(`Balance of ${taskArgs.address} for token ${taskArgs.token}: ${balance.toString()}`);
    });

task('upgrade-proxy', 'Upgrade a UUPS proxy to a new implementation')
    .addParam('proxyAddress', 'The address of the proxy contract')
    .addParam('contractName', 'The new contract implementation name')
    .addFlag('verify', 'Should we attempt to verify the new implementation')
    .addVariadicPositionalParam('args', 'The initializer arguments (if needed)', [])
    .setAction(async (taskArgs, hre) => {
        await hre.run('compile');
        consoleCyan('\n task: upgrade-proxy');
        consoleGreen(`Upgrading proxy at ${taskArgs.proxyAddress} to ${taskArgs.contractName}...`);

        const Contract = await hre.ethers.getContractFactory(taskArgs.contractName);
        const argsTypes = taskArgs.args.map((arg: string) => {
            if (arg === 'true' || arg === 'false') {
                return arg === 'true';
            } else {
                return arg;
            }
        });

        const upgraded = await hre.upgrades.upgradeProxy(
            taskArgs.proxyAddress,
            Contract,
            argsTypes.length > 0 ? { call: { fn: 'initialize', args: argsTypes } } : {},
        );
        await upgraded.waitForDeployment();
        const newImplAddress = await hre.upgrades.erc1967.getImplementationAddress(taskArgs.proxyAddress);

        console.log(`Proxy upgraded at: ${taskArgs.proxyAddress}`);
        console.log(`New implementation at:`);
        consoleYellow(`${newImplAddress}`);

        if (taskArgs.verify) {
            await hre.run('verify-contract', {
                address: newImplAddress,
                contractName: taskArgs.contractName,
                args: [],
            });
        }

        return { proxyAddress: taskArgs.proxyAddress, newImplAddress };
    });
