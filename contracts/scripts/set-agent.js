import hre from "hardhat";

const mustGetEnv = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

const contractIdToEvmAddress = (contractId) => {
  const parts = contractId.split(".");
  if (parts.length !== 3) throw new Error(`Invalid contract id: ${contractId}`);
  const num = BigInt(parts[2]);
  const hex = num.toString(16).padStart(40, "0");
  return `0x${hex}`;
};

const main = async () => {
  const { ethers } = await hre.network.connect();

  const vaultContractId = mustGetEnv("VAULT_CONTRACT_ID");
  const agentAddress = mustGetEnv("AGENT_ADDRESS").toLowerCase();
  const pk = mustGetEnv("HEDERA_PRIVATE_KEY");

  const vaultEvm = contractIdToEvmAddress(vaultContractId);
  const provider = ethers.provider;
  const signer = new ethers.Wallet(pk, provider);

  const abi = ["function setAgent(address newAgent) external", "function agent() view returns (address)"];
  const vault = new ethers.Contract(vaultEvm, abi, signer);

  const before = await vault.agent();
  console.log("Vault (Contract ID):", vaultContractId);
  console.log("Vault (EVM):", vaultEvm);
  console.log("Agent before:", before);
  console.log("Setting agent to:", agentAddress);

  const tx = await vault.setAgent(agentAddress);
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  const after = await vault.agent();
  console.log("Agent after:", after);
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
