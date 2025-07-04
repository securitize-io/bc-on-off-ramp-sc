import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'ethers';
import hre from 'hardhat';

export const EIP712_NAME = 'SecuritizeOnRamp';
export const EIP712_VERSION = '1';
export const DOMAIN_DATA = {
    name: EIP712_NAME,
    version: EIP712_VERSION,
};

export const eip712OnRamp = async (
    hsm: HardhatEthersSigner,
    onRampAddress: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    domainData: ethers.TypedDataDomain = DOMAIN_DATA,
) => {
    domainData.verifyingContract = onRampAddress;
    domainData.chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const types = {
        ExecutePreApprovedTransaction: [
            { name: 'senderInvestor', type: 'string' },
            { name: 'destination', type: 'address' },
            { name: 'data', type: 'bytes' },
            { name: 'nonce', type: 'uint256' },
        ],
    };

    return hsm.signTypedData(domainData, types, message);
};
