import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-viem";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    somnia: {
      url: process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network",
      chainId: 50312,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // Source verification — somnia.w3us.site is the Blockscout instance that indexes
  // this testnet chain and handles our viaIR build. No real API key is required.
  // (`npx hardhat verify --network somnia <addr> [args]` — all 5 verified here.)
  etherscan: {
    apiKey: { somnia: "verifyme" },
    customChains: [
      {
        network: "somnia",
        chainId: 50312,
        urls: {
          apiURL: process.env.VERIFY_API_URL ?? "https://somnia.w3us.site/api",
          browserURL: process.env.VERIFY_BROWSER_URL ?? "https://somnia.w3us.site",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  paths: {
    sources: "./contracts",
    scripts: "./scripts",
    artifacts: "./artifacts",
  },
};

export default config;
