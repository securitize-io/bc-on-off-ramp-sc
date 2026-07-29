import { ethers } from 'hardhat';

/**
 * Sets the MbpsFeeManager fee to 50 MBPS (= 5 bps = 0.05%) on Sepolia.
 * Run: npx hardhat run scripts/set-fee-mbps.ts --network sepolia
 */
async function main() {
    const ADDRESS = '0xE0273297299e4f92eAa2D462d992f346090Fb2F5';
    const NEW_FEE_MBPS = 50n; // 5 bps

    const [signer] = await ethers.getSigners();
    console.log('Signer:', signer.address);
    console.log('Network:', (await ethers.provider.getNetwork()).name, (await ethers.provider.getNetwork()).chainId);

    const feeManager = await ethers.getContractAt('MbpsFeeManager', ADDRESS);

    const adminRole = await feeManager.DEFAULT_ADMIN_ROLE();
    const isAdmin = await feeManager.hasRole(adminRole, signer.address);
    console.log('Signer has DEFAULT_ADMIN_ROLE:', isAdmin);
    if (!isAdmin) {
        throw new Error('Signer does NOT have DEFAULT_ADMIN_ROLE; setFeePercentageMBPS would revert.');
    }

    const current = await feeManager.feePercentageMBPS();
    console.log('Current feePercentageMBPS:', current.toString());

    console.log(`Sending setFeePercentageMBPS(${NEW_FEE_MBPS})...`);
    const tx = await feeManager.setFeePercentageMBPS(NEW_FEE_MBPS);
    console.log('Tx hash:', tx.hash);
    const receipt = await tx.wait();
    console.log('Confirmed in block:', receipt?.blockNumber, '| status:', receipt?.status);

    const updated = await feeManager.feePercentageMBPS();
    console.log('New feePercentageMBPS:', updated.toString());
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
