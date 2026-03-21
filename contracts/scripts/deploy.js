import hre from "hardhat";

const evmToContractId = (evmAddress) => {
  const hex = evmAddress.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) return null;
  const last16 = hex.slice(24);
  const num = BigInt(`0x${last16}`).toString(10);
  return `0.0.${num}`;
};

const lookupContractIdFromMirror = async (mirrorBaseUrl, evmAddress) => {
  try {
    const url = `${mirrorBaseUrl.replace(/\/$/, "")}/contracts/${evmAddress}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.contract_id === "string" ? json.contract_id : null;
  } catch {
    return null;
  }
};

const main = async () => {
  const { ethers } = await hre.network.connect();
  const pk = process.env.HEDERA_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY ?? "";
  const [defaultSigner] = await ethers.getSigners();
  const provider = ethers.provider;
  const deployer = pk ? new ethers.Wallet(pk, provider) : defaultSigner;
  if (!deployer) throw new Error("No deployer signer available. Set HEDERA_PRIVATE_KEY (0x...)");

  const agent = process.env.AGENT_ADDRESS ?? deployer.address;

  let gasPrice;
  try {
    gasPrice = await provider.getGasPrice();
  } catch {
    const hex = await provider.send("eth_gasPrice", []);
    gasPrice = BigInt(hex);
  }

  const Vault = await ethers.getContractFactory("HederaIntentVault", deployer);
  const vault = await Vault.deploy(agent, { gasLimit: 3_000_000, gasPrice });
  await vault.waitForDeployment();

  const evm = await vault.getAddress();
  console.log("Deployer:", deployer.address);
  console.log("Agent:", agent);
  console.log("HederaIntentVault (EVM):", evm);
  const mirrorUrl = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
  const mirrorContractId = await lookupContractIdFromMirror(mirrorUrl, evm.toLowerCase());
  console.log("HederaIntentVault (Contract ID):", mirrorContractId ?? evmToContractId(evm));
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
