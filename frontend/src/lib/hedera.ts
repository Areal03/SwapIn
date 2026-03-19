import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@hashgraph/sdk";

export const isSimulation = () => (process.env.SIMULATION ?? "true").toLowerCase() === "true";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const mustGetEnv = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const getDepositAddress = () => process.env.CONTRACT_ADDRESS ?? "";

const parseHederaPrivateKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith("0x")) {
    return PrivateKey.fromStringECDSA(key.slice(2));
  }

  const without0x = key;

  if (PrivateKey.isDerKey(without0x)) return PrivateKey.fromStringDer(without0x);

  const algo = PrivateKey.getAlgorithm(without0x);
  if (algo === "ecdsa") return PrivateKey.fromStringECDSA(without0x);
  return PrivateKey.fromStringED25519(without0x);
};

export const getHederaClient = () => {
  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  const operatorId = mustGetEnv("HEDERA_ACCOUNT_ID");
  const operatorKey = mustGetEnv("HEDERA_PRIVATE_KEY");

  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), parseHederaPrivateKey(operatorKey));
  return client;
};

export const refundHbar = async (input: { userWallet: string; amountHbar: string }) => {
  if (isSimulation()) {
    await sleep(800);
    return { txHash: `sim_refund_${Date.now()}` };
  }

  const sourceAccountId = mustGetEnv("HEDERA_ACCOUNT_ID");
  const client = getHederaClient();
  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(sourceAccountId), new Hbar(-Number(input.amountHbar)))
    .addHbarTransfer(AccountId.fromString(input.userWallet), new Hbar(Number(input.amountHbar)));

  const res = await tx.execute(client);
  const receipt = await res.getReceipt(client);
  const status = receipt.status.toString();
  if (status !== "SUCCESS") throw new Error(`Refund failed: ${status}`);

  return { txHash: res.transactionId.toString() };
};
