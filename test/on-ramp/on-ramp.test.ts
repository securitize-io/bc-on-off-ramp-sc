import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployOnRampAllowance, HASH } from './fixture';
import { ethers } from 'ethers';

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

    // it('Should fail to subscribe with all methods if contract is paused', async function () {
    //   const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
    //   await onRamp.pause();
    //   expect(await onRamp.paused()).to.equal(true);
    //   await expect(onRamp.subscribe(
    //     '', unknownWallet, 'US', [], [], [], 0, 0, 0, HASH
    //   )).revertedWithCustomError(onRamp, 'EnforcedPause');
    //   await expect(onRamp.swapFor(0, 0)).revertedWithCustomError(onRamp, 'EnforcedPause');
    //   await expect(onRamp.swap(0, 0)).revertedWithCustomError(onRamp, 'EnforcedPause');
    // });
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
    it('Should fail when trying to toggle investor headless methods', async function () {
      const { onRamp, unknownWallet } = await loadFixture(deployOnRampAllowance);
      const onRampFromUnauthorized = await onRamp.connect(unknownWallet);
      await expect(onRampFromUnauthorized.toggleInvestorSubscription(true)).revertedWithCustomError(
        onRamp,
        'OwnableUnauthorizedAccount',
      );
    });

    it('Should toggle investor headless methods', async function () {
      const { onRamp } = await loadFixture(deployOnRampAllowance);
      await expect(onRamp.toggleInvestorSubscription(true))
        .emit(onRamp, 'InvestorSubscriptionUpdated')
        .withArgs(true);
      expect(await onRamp.investorSubscriptionEnabled()).to.equal(true);
    });

    // it('Should fail swaps if headless methods are disabled', async function () {
    //   const { onRamp } = await loadFixture(deployOnRampAllowance);
    //   await expect(onRamp.swap(0, 0)).revertedWithCustomError(
    //     onRamp,
    //     'InvestorSubscriptionDisabledError',
    //   );
    // });
  });
});
