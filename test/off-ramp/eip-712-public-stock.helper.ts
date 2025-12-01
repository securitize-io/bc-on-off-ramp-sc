import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'ethers';
import hre from 'hardhat';

export const EIP712_NAME_PUBLIC_STOCK_OFF_RAMP = 'PublicStockOffRamp';
export const EIP712_VERSION = '1';
export const DOMAIN_DATA = {
    name: EIP712_NAME_PUBLIC_STOCK_OFF_RAMP,
    version: EIP712_VERSION,
};

/**
 * Helper function to create EIP-712 signature for PublicStockOffRamp.redeem()
 * @param signer The wallet signing the typed data
 * @param contractAddress The PublicStockOffRamp contract address
 * @param assetAmount Amount of DS tokens being redeemed
 * @param minOutputAmount Minimum liquidity tokens expected (slippage protection)
 * @param domainData Optional custom domain data
 * @returns Signature bytes
 */
export const eip712PublicStockOffRampRedeem = async (
    signer: HardhatEthersSigner,
    contractAddress: string,
    assetAmount: bigint,
    minOutputAmount: bigint,
    domainData: ethers.TypedDataDomain = DOMAIN_DATA,
) => {
    domainData.verifyingContract = contractAddress;
    domainData.chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const types = {
        Redeem: [
            { name: 'assetAmount', type: 'uint256' },
            { name: 'minOutputAmount', type: 'uint256' },
        ],
    };

    const message = {
        assetAmount: assetAmount.toString(),
        minOutputAmount: minOutputAmount.toString(),
    };

    return signer.signTypedData(domainData, types, message);
};
