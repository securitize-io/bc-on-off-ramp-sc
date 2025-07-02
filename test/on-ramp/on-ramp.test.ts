import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployOnRampAllowance, HASH } from './fixture';
import { Contract, ethers } from 'ethers';
import hre from 'hardhat';
import { eip712OnRamp } from './eip-712.helper';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

const buildTypedData = async (onRamp: Contract, subscribeParams: any) => {
  const data = onRamp.interface.encodeFunctionData("subscribe", subscribeParams);
  const nonce = await onRamp.nonceByInvestor('1');

  return {
    senderInvestor: '1',
    destination: await onRamp.getAddress(),
    executor: ethers.ZeroAddress,
    data,
    nonce
  };
}

describe('On-Ramp Unit Tests', function() {
  describe('Creation', function() {
    it('Should fail when trying to initialize twice', async function() {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.initialize(unknownWallet, unknownWallet, unknownWallet, unknownWallet, unknownWallet))
        .revertedWithCustomError(onRamp, 'InvalidInitialization');
    });

    it('Should get version correctly', async function() {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.getInitializedVersion()).to.equal(1);
    });

    it('Should get implementation address correctly', async function() {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.getImplementationAddress()).to.be.exist;
    });
  });

  describe('Pause/Unpause', function () {
    it('Should fail when trying to pause with unauthorized wallet', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.pause()).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });
  });

  describe('Set asset provider', function () {
    it('Should fail when trying to set an asset provider with unauthorized wallet', async function () {
      const { onRamp, assetProvider, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.updateAssetProvider(assetProvider)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should set a new asset provider', async function () {
      const { onRamp, assetProvider } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.updateAssetProvider(assetProvider))
        .emit(onRamp, 'AssetProviderUpdated')
        .withArgs(assetProvider, assetProvider);
      expect(await onRamp.assetProvider()).to.equal(assetProvider);
    });
  });

  describe('Set nav provider', function () {
    it('Should fail when trying to set a nav provider with unauthorized wallet', async function () {
      const { onRamp, navMock, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.updateNavProvider(navMock)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should set a new nav provider', async function () {
      const { onRamp, navMock } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.updateNavProvider(navMock))
        .emit(onRamp, 'NavProviderUpdated')
        .withArgs(navMock, navMock);
      expect(await onRamp.navProvider()).to.equal(navMock);
    });
  });

  describe('Set min subscription amount', function () {
    it('Should fail when trying to set new subscription amount with unauthorized wallet', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.updateMinSubscriptionAmount(0)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should update the minimum subscription amount', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.updateMinSubscriptionAmount(1))
        .emit(onRamp, 'MinSubscriptionAmountUpdated')
        .withArgs(0, 1);
      expect(await onRamp.minSubscriptionAmount()).to.equal(1);
    });
  });

  describe('Set bridge params', function () {
    it('Should fail when trying to set bridge params with unauthorized wallet', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.updateBridgeParams(1, ethers.ZeroAddress)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should update set bridge params', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.updateBridgeParams(1, ethers.ZeroAddress))
        .emit(onRamp, 'BridgeParamsUpdated')
        .withArgs(1, ethers.ZeroAddress);
      expect(await onRamp.bridgeChainId()).to.equal(1);
      expect(await onRamp.USDCBridge()).to.equal(ethers.ZeroAddress);
    });
  });

  describe('Toggle investor headless methods', function () {
    it('Should fail when trying to toggle investor headless methods from unauthorized wallet', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.toggleInvestorSubscription(true)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should fail when trying to investor headless methods with same value', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.investorSubscriptionEnabled()).to.equal(false);
      await expect(onRamp.toggleInvestorSubscription(false)).revertedWithCustomError(
        onRamp,
        'SameValueError',
      );
    });

    it('Should toggle investor headless methods', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.investorSubscriptionEnabled()).to.equal(false);
      await expect(onRamp.toggleInvestorSubscription(true))
        .emit(onRamp, 'InvestorSubscriptionUpdated')
        .withArgs(true);
      expect(await onRamp.investorSubscriptionEnabled()).to.equal(true);
    });
  });

  describe('Toggle tow step transfer', function () {
    it('Should fail when trying to toggle two step transfer from unauthorized wallet', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.toggleTwoStepTransfer(true)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should fail when trying to toggle two step transfer with same value', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.twoStepTransfer()).to.equal(false);
      await expect(onRamp.toggleTwoStepTransfer(false)).revertedWithCustomError(
        onRamp,
        'SameValueError',
      );
    });

    it('Should toggle two step transfer', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      expect(await onRamp.twoStepTransfer()).to.equal(false);
      await expect(onRamp.toggleTwoStepTransfer(true))
        .emit(onRamp, 'TwoStepTransferUpdated')
        .withArgs(true);
      expect(await onRamp.twoStepTransfer()).to.equal(true);
    });
  });

  describe('Subscribe Operations', function () {
    describe('Subscribe method', function () {
      it('Should fail to subscribe if contract is paused', async function () {
        const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
        await onRamp.pause();
        expect(await onRamp.paused()).to.equal(true);
        await expect(onRamp.subscribe('', unknownWallet, 'US', [], [], [], 0, 0, 0, HASH))
          .revertedWithCustomError(onRamp, 'EnforcedPause');
      });

      it('Should fail to subscribe if caller is not on ramp', async function () {
        const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
        await expect(onRamp.subscribe('', unknownWallet, 'US', [], [], [], 0, 0, 0, HASH))
          .revertedWithCustomError(onRamp, 'OnlySecuritizeOnRampError');
      });

      describe('EIP712 data encode execution', function () {
        let onRamp: Contract, mockTrustService: Contract, usdcMock: Contract, dsTokenMock: Contract, assetProvider: Contract;
        let unknownWallet: HardhatEthersSigner, eip712Signer: HardhatEthersSigner, assetProviderWallet: HardhatEthersSigner;
        let custodianWallet: HardhatEthersSigner, feeCollector: HardhatEthersSigner;
        let blockNumber: number;
        beforeEach(async function () {
          ({
            onRamp,
            mockTrustService,
            usdcMock,
            unknownWallet,
            eip712Signer,
            dsTokenMock,
            assetProvider,
            assetProviderWallet,
            custodianWallet,
            feeCollector
          } = await loadFixture(deployOnRampAllowance));
          const block = await hre.ethers.provider.getBlock('latest');
          blockNumber = block?.number || 0;
        });

        it('Should fail - eip712 signer has no permissions', async function () {
          await mockTrustService.setRole(await eip712Signer.getAddress(), 0);
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 0, 1e6, 0, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'InvalidEIP712SignatureError');
        });

        it('Should fail - tx data corrupted', async function () {
          await mockTrustService.setRole(await eip712Signer.getAddress(), 0);
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 0, 1e6, 0, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          txData.nonce = 2;
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'InvalidEIP712SignatureError');
        });

        it('Should fail if usdc amount is lower than minSubscriptionAmount', async function () {
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 0, 1e6, 0, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          await onRamp.updateMinSubscriptionAmount(2e6);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'MinSubscriptionAmountError');
        });

        it('Should fail - block limit expires', async function () {
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 0, 1e6, 0, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'TransactionTooOldError');
        });

        it('Should fail - slippage error', async function () {
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 2e6, 1e6, blockNumber + 1, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'SlippageControlError');
        });

        it('Should fail - investor with insufficient liquidity', async function () {
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 998000, 1e6, blockNumber + 1, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(onRamp, 'InsufficientERC20BalanceError');
        });

        it('Should fail - investor insufficient allowance', async function () {
          await usdcMock.mint(unknownWallet, 1e6);
          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 998000, 1e6, blockNumber + 10, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(usdcMock, 'ERC20InsufficientAllowance');
        });

        it('Should fail - allowance asset provider - insufficient allowance', async function () {
          await usdcMock.mint(unknownWallet, 10e6);

          const liquidityFromInvestor = usdcMock.connect(unknownWallet) as Contract;
          await liquidityFromInvestor.approve(onRamp, 1e6);

          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 998000, 1e6, blockNumber + 10, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(dsTokenMock, 'ERC20InsufficientAllowance');
        });

        it('Should fail - allowance asset provider - insufficient balance', async function () {
          await usdcMock.mint(unknownWallet, 10e6);

          const liquidityFromInvestor = usdcMock.connect(unknownWallet) as Contract;
          await liquidityFromInvestor.approve(onRamp, 1e6);

          const dsTokenFromAssetProviderWallet = dsTokenMock.connect(assetProviderWallet) as Contract;
          await dsTokenFromAssetProviderWallet.approve(assetProvider, 1e6);

          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 998000, 1e6, blockNumber + 10, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);
          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .revertedWithCustomError(dsTokenMock, 'ERC20InsufficientBalance');
        });

        it('Should subscribe successfully', async function () {
          await usdcMock.mint(unknownWallet, 1e6);
          await dsTokenMock.issueTokens(assetProviderWallet, 1e6);

          const liquidityFromInvestor = usdcMock.connect(unknownWallet) as Contract;
          await liquidityFromInvestor.approve(onRamp, 1e6);

          const calculatedDSTokenAmount = await onRamp.calculateDsTokenAmount(1e6)

          const dsTokenFromAssetProviderWallet = dsTokenMock.connect(assetProviderWallet) as Contract;
          await dsTokenFromAssetProviderWallet.approve(assetProvider, 1e6);

          const subscribeParams = ['1', await unknownWallet.getAddress(), 'US', [], [], [], 998000, 1e6, blockNumber + 10, HASH];
          const txData = await buildTypedData(onRamp, subscribeParams);
          const signature = await eip712OnRamp(eip712Signer, await onRamp.getAddress(), txData);

          await expect(onRamp.executePreApprovedTransaction(signature, txData))
            .emit(onRamp, 'Swap').withArgs(onRamp, calculatedDSTokenAmount, 1e6, unknownWallet)
            .emit(onRamp, 'DocumentSigned').withArgs(unknownWallet, HASH)
          expect(await usdcMock.balanceOf(unknownWallet)).to.equal(0);
          expect(await dsTokenMock.balanceOf(unknownWallet)).to.equal(calculatedDSTokenAmount);
          // custodian wallet
          expect(await usdcMock.balanceOf(custodianWallet)).to.equal(998000);
          // fee collector
          expect(await usdcMock.balanceOf(feeCollector)).to.equal(1e6 - Number(calculatedDSTokenAmount));
          // asset provider wallet
          expect(await dsTokenMock.balanceOf(assetProviderWallet)).to.equal(1e6 - Number(calculatedDSTokenAmount));
        });
      });
    });
  });
});
