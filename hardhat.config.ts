import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import 'dotenv/config';
import './tasks/commons';
import './tasks/off-ramp/deploy-redemption-collateral-protocol';
import './tasks/off-ramp/deploy-redemption-allowance-protocol';
import './tasks/off-ramp/update-countries-restriction';

const config: HardhatUserConfig = {
    mocha: {
        parallel: false,
    },
    solidity: {
        version: '0.8.22',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        sepolia: {
            chainId: 11155111,
            url: process.env.SEPOLIA_RPC_URL ?? '',
            accounts: [process.env.DEPLOYER_PRIV_KEY!].filter((x) => x),
        },
        arbitrum: {
            chainId: 421614,
            gas: 'auto',
            url: process.env.ARBITRUM_RPC_URL ?? '',
            accounts: [process.env.DEPLOYER_PRIV_KEY!].filter((x) => x),
            allowUnlimitedContractSize: true,
        },
        optimism: {
            chainId: 11155420,
            url: process.env.OPTIMISM_RPC_URL ?? '',
            accounts: [process.env.DEPLOYER_PRIV_KEY!].filter((x) => x),
        },
    },
    etherscan: {
        apiKey: {
            mainnet: process.env.API_KEY_ETHERSCAN || '',
            sepolia: process.env.API_KEY_ETHERSCAN || '',
            arbitrumOne: process.env.API_KEY_ARBISCAN || '',
            arbitrumSepolia: process.env.API_KEY_ARBISCAN || '',
            optimisticEthereum: process.env.API_KEY_OPTIMISTIC || '',
            optimisticSepolia: process.env.API_KEY_OPTIMISTIC || '',
        },
    },
};

export default config;
