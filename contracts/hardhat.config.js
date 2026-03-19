import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";

const privateKey = process.env.HEDERA_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY ?? "";
const accounts = privateKey ? [privateKey] : [];

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatEthersChaiMatchers],
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hedera_testnet: {
      type: "http",
      url: process.env.HEDERA_TESTNET_RPC_URL ?? "https://testnet.hashio.io/api",
      chainId: 296,
      accounts
    },
    hedera_mainnet: {
      type: "http",
      url: process.env.HEDERA_MAINNET_RPC_URL ?? "https://mainnet.hashio.io/api",
      chainId: 295,
      accounts
    }
  }
});
