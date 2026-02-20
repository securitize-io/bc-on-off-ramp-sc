import { task, types } from 'hardhat/config';
import { Wallet } from 'ethers';
import { consoleCyan, consoleGreen, consoleYellow } from '../../utils';
import { eip712PublicStockOnRampSwap } from '../../test/on-ramp/eip-712-public-stock.helper';

task('sign-public-stock-on-ramp', 'Generate EIP-712 signature for PublicStockOnRamp.swap()')
    .addParam('contract', 'PublicStockOnRamp contract address', undefined, types.string)
    .addParam('liquidityamount', 'Amount of liquidity tokens being swapped', undefined, types.string)
    .addParam('minoutamount', 'Minimum DS tokens expected (slippage protection)', undefined, types.string)
    .addOptionalParam('privateKey', 'Private key override for signing wallet', undefined, types.string)
    .setAction(async (args, hre) => {
        consoleCyan('\n task: sign-public-stock-on-ramp');
        consoleCyan('Arguments:');
        console.log(`- Contract: ${args.contract}`);
        console.log(`- Liquidity Amount: ${args.liquidityamount}`);
        console.log(`- Min Out Amount: ${args.minoutamount}`);

        const liquidityAmount = BigInt(args.liquidityamount);
        const minOutAmount = BigInt(args.minoutamount);

        const signer =
            args.privateKey !== undefined
                ? new Wallet(args.privateKey, hre.ethers.provider)
                : (await hre.ethers.getSigners())[0];

        consoleYellow(`Using signer: ${signer.address}`);

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const contract = await hre.ethers.getContractAt(
          'PublicStockOnRamp',
            args.contract
        );

        const signature = await eip712PublicStockOnRampSwap(
            signer,
            args.contract,
            liquidityAmount,
            minOutAmount,
            await contract.nonces(signer.address),
            deadline,
        );

        consoleGreen(`Signature: ${signature}`);

        return {
            contract: args.contract,
            signer: signer.address,
            liquidityAmount: liquidityAmount.toString(),
            minOutAmount: minOutAmount.toString(),
            signature,
        };
    });
