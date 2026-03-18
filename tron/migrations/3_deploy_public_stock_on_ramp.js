/* eslint-disable @typescript-eslint/no-require-imports */
/* global artifacts */
const PublicStockOnRamp = artifacts.require('PublicStockOnRamp');
const MintingAssetProvider = artifacts.require('MintingAssetProvider');
const AllowanceAssetProvider = artifacts.require('AllowanceAssetProvider');
const ERC1967Proxy = artifacts.require('ERC1967Proxy');
const { TronWeb } = require('tronweb');

const ASSET_PROVIDER_TYPE = process.env.ASSET_PROVIDER_TYPE || 'minting';

function toHex(address) {
  if (address.startsWith('0x')) return address;
  if (address.startsWith('41')) return '0x' + address.slice(2);
  return '0x' + TronWeb.address.toHex(address).slice(2);
}

function encodeInitData(artifact, args) {
  const initAbi = artifact.abi.find((f) => f.name === 'initialize' && f.type === 'function');
  if (!initAbi) throw new Error('initialize function not found in ABI');
  const types = initAbi.inputs.map((i) => i.type);
  const hexArgs = args.map((a, i) => (types[i] === 'address' ? toHex(a) : a));
  const { AbiCoder } = require('ethers');
  const coder = new AbiCoder();
  const selector = require('ethers').id('initialize(' + types.join(',') + ')').slice(0, 10);
  const encoded = coder.encode(types, hexArgs);
  return selector + encoded.slice(2);
}

module.exports = async function (deployer) {
  const dsToken = process.env.DS_TOKEN_ADDRESS;
  const liquidity = process.env.LIQUIDITY_TOKEN_ADDRESS;
  const navProvider = process.env.NAV_PROVIDER_ADDRESS;
  const feeManager = process.env.FEE_MANAGER_ADDRESS;
  const custodianWallet = process.env.CUSTODIAN_WALLET_ADDRESS;
  const allowanceProvider = process.env.ALLOWANCE_PROVIDER_ADDRESS;

  if (!dsToken || !liquidity || !navProvider || !feeManager || !custodianWallet) {
    throw new Error(
      'Missing required env vars: DS_TOKEN_ADDRESS, LIQUIDITY_TOKEN_ADDRESS, NAV_PROVIDER_ADDRESS, FEE_MANAGER_ADDRESS, CUSTODIAN_WALLET_ADDRESS',
    );
  }

  // --- Deploy PublicStockOnRamp ---
  console.log('Deploying PublicStockOnRamp implementation...');
  await deployer.deploy(PublicStockOnRamp);
  const onRampImpl = await PublicStockOnRamp.deployed();
  console.log(`  Implementation: ${onRampImpl.address}`);

  const onRampInitData = encodeInitData(PublicStockOnRamp, [dsToken, liquidity, navProvider, feeManager, custodianWallet]);

  console.log('Deploying PublicStockOnRamp proxy...');
  await deployer.deploy(ERC1967Proxy, onRampImpl.address, onRampInitData);
  const onRampProxyAddress = ERC1967Proxy.address;
  console.log(`  Proxy: ${onRampProxyAddress}`);

  // --- Deploy AssetProvider ---
  let assetProviderProxyAddress;

  if (ASSET_PROVIDER_TYPE === 'allowance') {
    if (!allowanceProvider) {
      throw new Error('ALLOWANCE_PROVIDER_ADDRESS is required for allowance asset provider type');
    }
    console.log('Deploying AllowanceAssetProvider implementation...');
    await deployer.deploy(AllowanceAssetProvider);
    const allowanceImpl = await AllowanceAssetProvider.deployed();
    console.log(`  Implementation: ${allowanceImpl.address}`);

    const allowanceInitData = encodeInitData(AllowanceAssetProvider, [dsToken, onRampProxyAddress, allowanceProvider]);

    console.log('Deploying AllowanceAssetProvider proxy...');
    await deployer.deploy(ERC1967Proxy, allowanceImpl.address, allowanceInitData);
    assetProviderProxyAddress = ERC1967Proxy.address;
    console.log(`  Proxy: ${assetProviderProxyAddress}`);
    console.warn('Remember to approve allowance to the AssetProvider contract.');
  } else {
    console.log('Deploying MintingAssetProvider implementation...');
    await deployer.deploy(MintingAssetProvider);
    const mintingImpl = await MintingAssetProvider.deployed();
    console.log(`  Implementation: ${mintingImpl.address}`);

    const mintingInitData = encodeInitData(MintingAssetProvider, [dsToken, onRampProxyAddress]);

    console.log('Deploying MintingAssetProvider proxy...');
    await deployer.deploy(ERC1967Proxy, mintingImpl.address, mintingInitData);
    assetProviderProxyAddress = ERC1967Proxy.address;
    console.log(`  Proxy: ${assetProviderProxyAddress}`);
    console.warn('Remember to grant issuer permissions to the MintingAssetProvider.');
  }

  // --- Link AssetProvider to OnRamp ---
  console.log('Linking AssetProvider to OnRamp...');
  const onRamp = await PublicStockOnRamp.at(onRampProxyAddress);
  await onRamp.updateAssetProvider(assetProviderProxyAddress);
  console.log('AssetProvider linked.');

  console.log('\n=== PublicStockOnRamp Deployed ===');
  console.log(`  OnRamp Proxy:          ${onRampProxyAddress}`);
  console.log(`  OnRamp Implementation: ${onRampImpl.address}`);
  console.log(`  AssetProvider (${ASSET_PROVIDER_TYPE}) Proxy: ${assetProviderProxyAddress}`);

  console.log('\nPost-deploy reminders:');
  console.log('  - Grant OPERATOR_ROLE on the OnRamp contract');
  console.log('  - Configure minSubscriptionAmount if needed');
  console.log('  - Register the on-ramp address in the Abstraction Layer');
};
