import { config } from "./config.js";

type MirrorTransactionTransfer = {
  account: string;
  amount: number;
};

type MirrorTransaction = {
  transaction_id: string;
  consensus_timestamp: string;
  memo_base64?: string;
  transfers?: MirrorTransactionTransfer[];
};

type MirrorTransactionsResponse = {
  transactions?: MirrorTransaction[];
};

export type DetectedDeposit = {
  orderId: string;
  transactionId: string;
  consensusTimestamp: string;
  payer?: string;
  amountTinybar: string;
};

const decodeMemo = (memoBase64?: string) => {
  if (!memoBase64) return "";
  try {
    return Buffer.from(memoBase64, "base64").toString("utf8");
  } catch {
    return "";
  }
};

const findIncomingAmount = (transfers: MirrorTransactionTransfer[] | undefined, vaultAccountId: string) => {
  if (!transfers) return undefined;
  const incoming = transfers.find((t) => t.account === vaultAccountId && t.amount > 0);
  return incoming?.amount;
};

const findPayer = (transfers: MirrorTransactionTransfer[] | undefined) => {
  if (!transfers) return undefined;
  const negatives = transfers.filter((t) => t.amount < 0).sort((a, b) => a.amount - b.amount);
  return negatives[0]?.account;
};

export const pollDeposits = async (knownOrderIds: Set<string>, sinceConsensusTimestamp?: string) => {
  if (config.vaultContractId === "0.0.0") return [];

  const url = new URL(`${config.mirrorNodeUrl}/transactions`);
  url.searchParams.set("account.id", config.vaultContractId);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", "25");

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Mirror node error: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as MirrorTransactionsResponse;
  const txs = json.transactions ?? [];

  const detected: DetectedDeposit[] = [];
  for (const tx of txs) {
    if (sinceConsensusTimestamp && tx.consensus_timestamp <= sinceConsensusTimestamp) continue;
    const memo = decodeMemo(tx.memo_base64).trim();
    if (!memo) continue;
    if (!knownOrderIds.has(memo)) continue;

    const amount = findIncomingAmount(tx.transfers, config.vaultContractId);
    if (!amount || amount <= 0) continue;

    detected.push({
      orderId: memo,
      transactionId: tx.transaction_id,
      consensusTimestamp: tx.consensus_timestamp,
      payer: findPayer(tx.transfers),
      amountTinybar: String(amount)
    });
  }

  return detected;
};

