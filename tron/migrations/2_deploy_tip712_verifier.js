/* global artifacts */
const TIP712Verifier = artifacts.require('TIP712Verifier');

module.exports = async function (deployer) {
  console.log('Deploying TIP712Verifier...');
  await deployer.deploy(TIP712Verifier);
  const instance = await TIP712Verifier.deployed();
  console.log(`TIP712Verifier deployed at: ${TIP712Verifier.address}`);

  console.log('Initializing with PublicStockOnRamp domain...');
  await instance.initialize();
  console.log('TIP712Verifier initialized.');
};
