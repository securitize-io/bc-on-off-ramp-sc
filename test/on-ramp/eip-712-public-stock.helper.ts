import { ethers } from 'ethers';

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
 * @param nonce investor nonce
 * @param deadline
 * @param domainData Optional custom domain data
 * @returns Signature bytes
 */
export const eip712PublicStockOnRampSwap = async (
    signer: ethers.Signer,
    contractAddress: string,
    liquidityAmount: bigint,
    minOutAmount: bigint,
    nonce: bigint,
    deadline: bigint,
    domainData: ethers.TypedDataDomain = DOMAIN_DATA,
) => {
    const provider = signer.provider;
    if (!provider) {
        throw new Error('Signer must be connected to a provider to resolve chainId');
    }

    const domain: ethers.TypedDataDomain = {
        ...domainData,
        verifyingContract: contractAddress,
        chainId: domainData.chainId ?? (await provider.getNetwork()).chainId,
    };

    const types = {
        Swap: [
            { name: 'liquidityAmount', type: 'uint256' },
            { name: 'minOutputAmount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };

    const message = {
        liquidityAmount: liquidityAmount.toString(),
        minOutputAmount: minOutAmount.toString(),
        nonce,
        deadline,
    };

    return signer.signTypedData(domain, types, message);
};
