/**
 * TIP-712 End-to-End PoC
 *
 * Validates that a TIP-712 signature created off-chain with TronWeb
 * can be verified on-chain by the same EIP712Upgradeable + ECDSA.recover
 * logic used in PublicStockOnRamp/PublicStockOffRamp.
 *
 * Prerequisites:
 *   1. Deploy TIP712Verifier to Nile:
 *      npx tronbox migrate --network nile
 *
 *   2. Run this script:
 *      VERIFIER_ADDRESS=<addr> npx ts-node tron/scripts/tip712-poc.ts
 */

import 'dotenv/config';
import { TronWeb } from 'tronweb';

const PRIVATE_KEY = process.env.DEPLOYER_PRIV_KEY!;
const FULL_HOST = process.env.TRON_NILE_RPC_URL || 'https://nile.trongrid.io';
const API_KEY = process.env.API_KEY_TRONGRID || '';
const VERIFIER_ADDRESS = process.env.VERIFIER_ADDRESS!;

if (!PRIVATE_KEY || !VERIFIER_ADDRESS) {
    console.error('Missing DEPLOYER_PRIV_KEY or VERIFIER_ADDRESS env vars');
    process.exit(1);
}

const NILE_TIP712_CHAIN_ID = 3448148188;

const TIP712_VERIFIER_ABI = [
    {
        inputs: [
            { internalType: 'uint256', name: '_liquidityAmount', type: 'uint256' },
            { internalType: 'uint256', name: '_minOutputAmount', type: 'uint256' },
            { internalType: 'address', name: '_investorWallet', type: 'address' },
            { internalType: 'uint256', name: '_deadline', type: 'uint256' },
            { internalType: 'bytes', name: '_signature', type: 'bytes' },
        ],
        name: 'verifySwap',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
        name: 'getNonce',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

interface TypedDataDomain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
}

interface SwapMessage {
    liquidityAmount: string;
    minOutputAmount: string;
    nonce: number;
    deadline: number;
}

async function main(): Promise<void> {
    const tronWeb = new TronWeb({
        fullHost: FULL_HOST,
        privateKey: PRIVATE_KEY,
        headers: API_KEY ? { 'TRON-PRO-API-KEY': API_KEY } : {},
    });

    const signerAddress = tronWeb.defaultAddress.base58 as string;
    console.log(`Signer address: ${signerAddress}`);

    const contract = tronWeb.contract(TIP712_VERIFIER_ABI, VERIFIER_ADDRESS);

    const nonce = await contract.getNonce(signerAddress).call();
    console.log(`Current nonce: ${nonce}`);

    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const domain: TypedDataDomain = {
        name: 'PublicStockOnRamp',
        version: '1',
        chainId: NILE_TIP712_CHAIN_ID,
        verifyingContract: VERIFIER_ADDRESS,
    };

    const types = {
        Swap: [
            { name: 'liquidityAmount', type: 'uint256' },
            { name: 'minOutputAmount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };

    const message: SwapMessage = {
        liquidityAmount: '1000000',
        minOutputAmount: '900000',
        nonce: Number(nonce),
        deadline,
    };

    console.log('\n--- TIP-712 Typed Data ---');
    console.log('Domain:', JSON.stringify(domain, null, 2));
    console.log('Message:', JSON.stringify(message, null, 2));

    console.log('\nSigning TIP-712 message off-chain...');
    const signature = await tronWeb.trx._signTypedData(domain, types, message, PRIVATE_KEY);
    console.log(`Signature: ${signature}`);

    console.log('\nVerifying off-chain with TronWeb...');
    const isValid = tronWeb.trx.verifyTypedData(domain, types, message, signature, signerAddress);
    console.log(`Off-chain valid: ${isValid}`);

    console.log('\nVerifying on-chain (calling verifySwap)...');
    const tx = await contract
        .verifySwap(
            BigInt(message.liquidityAmount),
            BigInt(message.minOutputAmount),
            signerAddress,
            BigInt(message.deadline),
            signature,
        )
        .send({ feeLimit: 100000000 });

    console.log(`Transaction hash: ${tx}`);

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const newNonce = await contract.getNonce(signerAddress).call();
    console.log(`Nonce after verification: ${newNonce}`);

    const nonceIncremented = Number(newNonce) === Number(nonce) + 1;

    console.log('\n=== TIP-712 PoC Result ===');
    console.log(`Off-chain verification: ${isValid ? 'PASS' : 'FAIL'}`);
    console.log(`On-chain verification (nonce ${nonce} -> ${newNonce}): ${nonceIncremented ? 'PASS' : 'FAIL'}`);
}

main().catch((err) => {
    console.error('PoC failed:', err);
    process.exit(1);
});
