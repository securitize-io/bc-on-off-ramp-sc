import { expect } from 'chai';
import {
    COLLATERAL_TREASURY,
    deployRedemptionProtocolWithMultipleTokens,
    FIXED_RATE,
    investorCountry,
    MIN_OUTPUT_AMOUNT,
} from './fixture';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';

const DIGITAL_ASSET_AMOUNT = 30n;

describe('Securitize Redemption Multiple Decimals', function () {
    it('Should redeem investor with correct decimals', async function () {
        const [securitizeWallet, investor] = await hre.ethers.getSigners();
        const {
            contractsWith0DecimalsDsTokenMock,
            contractsWith6DecimalsDsTokenMock,
            contractsWith18DecimalsDsTokenMock,
            dsToken0DecimalMock,
            dsToken6DecimalMock,
            dsToken18DecimalMock,
            dsTokenCollateralMock,
            usdcMock,
            externalRedemptionContractMock,
            securitizeNavProviderMock,
        } = await loadFixture(deployRedemptionProtocolWithMultipleTokens);

        const externalRedemptionAddress = await externalRedemptionContractMock.getAddress();

        const tokenTestCases = [
            {
                dsToken: dsToken0DecimalMock,
                contract: contractsWith0DecimalsDsTokenMock,
            },
            {
                dsToken: dsToken6DecimalMock,
                contract: contractsWith6DecimalsDsTokenMock,
            },
            {
                dsToken: dsToken18DecimalMock,
                contract: contractsWith18DecimalsDsTokenMock,
            },
        ];

        // provide collateral asset to securitize wallet
        await dsTokenCollateralMock.mint(securitizeWallet, COLLATERAL_TREASURY);
        const currentRate = await securitizeNavProviderMock.rate();
        let totalCollateralToRedeem = 0n;
        for (const testCase of tokenTestCases) {
            const investorAssetAmount = DIGITAL_ASSET_AMOUNT * 10n ** (await testCase.dsToken.decimals());
            await testCase.dsToken.mint(investor, investorAssetAmount);

            const collateralToRedeem = (investorAssetAmount * currentRate) / 10n ** (await testCase.dsToken.decimals());
            totalCollateralToRedeem += collateralToRedeem;
            await dsTokenCollateralMock.approve(testCase.contract.liquidityProvider, collateralToRedeem);
            const dsTokenFromInvestorWith6Decimals = await testCase.dsToken.connect(investor);

            // @ts-expect-error approve method is not defined in BaseContract
            await dsTokenFromInvestorWith6Decimals.approve(
                await testCase.contract.redemption.getAddress(),
                investorAssetAmount,
            );
        }

        // provide liquidity to external mock contract
        await usdcMock.mint(externalRedemptionAddress, totalCollateralToRedeem);

        for (const tokenTestCase of tokenTestCases) {
            const redemptionFromInvestor = await tokenTestCase.contract.redemption.connect(investor);
            await redemptionFromInvestor.redeem(
                DIGITAL_ASSET_AMOUNT * 10n ** (await tokenTestCase.dsToken.decimals()),
                MIN_OUTPUT_AMOUNT, // Use constant for minimum output amount
            );
            expect(await tokenTestCase.dsToken.balanceOf(investor)).to.equal(0);
        }
        expect(await usdcMock.balanceOf(externalRedemptionAddress)).to.equal(0);
        expect(await dsTokenCollateralMock.balanceOf(securitizeWallet)).to.equal(
            COLLATERAL_TREASURY - totalCollateralToRedeem,
        );
    });
    it('Should revert when initializing with asset with excessive decimals', async function () {
        // Set up a mock Registry Service
        const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
        const mockRegistryService = await MockRegistryService.deploy(investorCountry);
        const registryServiceAddress = await mockRegistryService.getAddress();

        // Deploy token with excessive decimals (19, which exceeds max of 18)
        const excessiveDecimalsToken = await hre.ethers.deployContract('MockERC20', [
            'Excessive Decimals Token',
            'EXCSS',
            19,
            registryServiceAddress,
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

        // Set up a mock Registry Service for the excessive decimals token
        const MockRegistryService = await hre.ethers.getContractFactory('MockRegistryService');
        const mockRegistryService = await MockRegistryService.deploy(investorCountry);
        const registryServiceAddress = await mockRegistryService.getAddress();

        // Deploy token with excessive decimals (19)
        const excessiveDecimalsToken = await hre.ethers.deployContract('MockERC20', [
            'Excessive LP Token',
            'EXCLP',
            19,
            registryServiceAddress,
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
