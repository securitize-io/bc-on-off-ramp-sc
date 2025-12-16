import { task, types } from 'hardhat/config';
import { Wallet } from 'ethers';
import { consoleCyan, consoleGreen, consoleYellow } from '../../utils';
import { eip712PublicStockOffRampRedeem } from '../../test/off-ramp/eip-712-public-stock.helper';

task('sign-public-stock-off-ramp', 'Generate EIP-712 signature for PublicStockOffRamp.redeem()')
    .addParam('contract', 'PublicStockOffRamp contract address', undefined, types.string)
    .addParam('assetamount', 'Amount of DS tokens to redeem', undefined, types.string)
    .addParam('minoutputamount', 'Minimum liquidity tokens expected', undefined, types.string)
    .addOptionalParam('privateKey', 'Private key override for signing wallet', undefined, types.string)
    .setAction(async (args, hre) => {
        consoleCyan('\n task: sign-public-stock-off-ramp');
        consoleCyan('Arguments:');
        console.log(`- Contract: ${args.contract}`);
        console.log(`- Asset Amount: ${args.assetamount}`);
        console.log(`- Min Output Amount: ${args.minoutputamount}`);

        const assetAmount = BigInt(args.assetamount);
        const minOutputAmount = BigInt(args.minoutputamount);

        const signer =
            args.privateKey !== undefined
                ? new Wallet(args.privateKey, hre.ethers.provider)
                : (await hre.ethers.getSigners())[0];

        consoleYellow(`Using signer: ${signer.address}`);

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const contract = await hre.ethers.getContractAt(
          'PublicStockOffRamp',
          args.contract
        );

        const signature = await eip712PublicStockOffRampRedeem(
            signer,
            args.contract,
            assetAmount,
            minOutputAmount,
            await contract.nonces(signer.address),
            deadline,
        );

        consoleGreen(`Signature: ${signature}`);

        return {
            contract: args.contract,
            signer: signer.address,
            assetAmount: assetAmount.toString(),
            minOutputAmount: minOutputAmount.toString(),
            signature,
        };
    });
