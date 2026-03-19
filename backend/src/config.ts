import "dotenv/config";

export type AppConfig = {
  port: number;
  mirrorNodeUrl: string;
  vaultContractId: string;
  pollIntervalMs: number;
  simulation: boolean;
  hederaNetwork: "testnet" | "mainnet";
  operatorAccountId?: string;
  operatorPrivateKey?: string;
};

const numberFromEnv = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config: AppConfig = {
  port: numberFromEnv("PORT", 8080),
  mirrorNodeUrl: process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1",
  vaultContractId: process.env.VAULT_CONTRACT_ID ?? "0.0.0",
  pollIntervalMs: numberFromEnv("POLL_INTERVAL_MS", 4000),
  simulation: (process.env.SIMULATION ?? "true").toLowerCase() === "true",
  hederaNetwork: (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet",
  operatorAccountId: process.env.OPERATOR_ACCOUNT_ID,
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY
};

