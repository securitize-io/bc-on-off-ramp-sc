// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv/config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TronWeb } = require('tronweb');

const pk = process.env.DEPLOYER_PRIV_KEY;
if (pk) {
  console.log(`Deployer address: ${TronWeb.address.fromPrivateKey(pk)}`);
}

module.exports = {
  migrations_directory: './tron/migrations',
  networks: {
    nile: {
      privateKey: process.env.DEPLOYER_PRIV_KEY,
      userFeePercentage: 100,
      feeLimit: 1000000000,
      fullHost: process.env.TRON_NILE_RPC_URL || 'https://nile.trongrid.io',
      network_id: '*',
      headers: { 'TRON-PRO-API-KEY': process.env.API_KEY_TRONGRID || '' },
    },
  },
  compilers: {
    solc: {
      version: '0.8.22',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: 'istanbul',
        viaIR: true,
      },
    },
  },
};
