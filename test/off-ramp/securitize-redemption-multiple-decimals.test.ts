import { expect } from 'chai';
import { deployRedemptionProtocolWithMultipleTokens, FIXED_RATE } from './fixture';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';

describe('Securitize Redemption Multiple Decimals', function () {
    it('Should revert when initializing with asset with excessive decimals', async function () {
        // Deploy token with excessive decimals (19, which exceeds max of 18)
        const excessiveDecimalsToken = await hre.ethers.deployContract('MockERC20', [
            'Excessive Decimals Token',
            'EXCSS',
            19,
        ]);

        // Deploy NAV provider
        const securitizeNavProviderMock = await hre.ethers.deployContract('MockSecuritizeInternalNavProvider', [
            FIXED_RATE,
        ]);

        // Deploy redemption contract
        const Redemption = await hre.ethers.getContractFactory('SecuritizeOffRamp');

        // Should revert when initializing with token that has more than 18 decimals
        await expect(
            hre.upgrades.deployProxy(Redemption, [
                await excessiveDecimalsToken.getAddress(),
                await securitizeNavProviderMock.getAddress(),
                await hre.ethers.Wallet.createRandom().getAddress(), // Random address as fee manager
                false, // Don't burn assets
            ]),
        )
            .to.be.revertedWithCustomError(Redemption, 'ExcessiveDecimals')
            .withArgs(19, 18);
    });

    it('Should revert when updating liquidity provider with token having excessive decimals', async function () {
        const { contractsWith18DecimalsDsTokenMock } = await loadFixture(deployRedemptionProtocolWithMultipleTokens);

        // Deploy token with excessive decimals (19)
        const excessiveDecimalsToken = await hre.ethers.deployContract('MockERC20', [
            'Excessive LP Token',
            'EXCLP',
            19,
        ]);

        // Deploy liquidity provider with excessive decimals token but DON'T initialize it yet
        const CollateralLiquidityProvider = await hre.ethers.getContractFactory('CollateralLiquidityProvider');
        const liquidityProvider = await hre.upgrades.deployProxy(
            CollateralLiquidityProvider,
            [
                await excessiveDecimalsToken.getAddress(),
                await contractsWith18DecimalsDsTokenMock.redemption.getAddress(),
                await contractsWith18DecimalsDsTokenMock.redemption.getAddress(),
            ],
            { kind: 'uups' },
        );

        // Should revert when updating liquidity provider with excessive decimals token
        await expect(
            contractsWith18DecimalsDsTokenMock.redemption.updateLiquidityProvider(await liquidityProvider.getAddress()),
        )
            .to.be.revertedWithCustomError(contractsWith18DecimalsDsTokenMock.redemption, 'ExcessiveDecimals')
            .withArgs(19, 18);
    });
});
