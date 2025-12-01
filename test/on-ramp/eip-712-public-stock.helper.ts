import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'ethers';
import hre from 'hardhat';

export const EIP712_NAME_PUBLIC_STOCK_ON_RAMP = 'PublicStockOnRamp';
export const EIP712_VERSION = '1';
export const DOMAIN_DATA = {
    name: EIP712_NAME_PUBLIC_STOCK_ON_RAMP,
    version: EIP712_VERSION,
};

/**
 * Helper function to create EIP-712 signature for PublicStockOnRamp.swap()
 * @param signer The wallet signing the typed data
 * @param contractAddress The PublicStockOnRamp contract address
 * @param liquidityAmount Amount of liquidity tokens being swapped
 * @param minOutAmount Minimum DS tokens expected (slippage protection)
 * @param domainData Optional custom domain data
 * @returns Signature bytes
 */
export const eip712PublicStockOnRampSwap = async (
    signer: HardhatEthersSigner,
    contractAddress: string,
    liquidityAmount: bigint,
    minOutAmount: bigint,
    domainData: ethers.TypedDataDomain = DOMAIN_DATA,
) => {
    domainData.verifyingContract = contractAddress;
    domainData.chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const types = {
        Swap: [
            { name: 'liquidityAmount', type: 'uint256' },
            { name: 'minOutAmount', type: 'uint256' },
        ],
    };

    const message = {
        liquidityAmount: liquidityAmount.toString(),
        minOutAmount: minOutAmount.toString(),
    };

    return signer.signTypedData(domainData, types, message);
};
