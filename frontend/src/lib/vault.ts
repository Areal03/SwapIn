import BigNumber from "bignumber.js";
import {
  AccountId,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar
} from "@hashgraph/sdk";
import { getHederaClient, isSimulation } from "./hedera";
import type { DbOrder } from "./types";

const mustGetEnv = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const isVaultContractMode = () => (process.env.VAULT_KIND ?? "account").toLowerCase() === "contract";

const getVaultContractId = () => ContractId.fromString(mustGetEnv("CONTRACT_ADDRESS"));

const memoToBytes32 = (memo: string) => {
  const b = Buffer.alloc(32);
  Buffer.from(memo, "utf8").copy(b, 0, 0, 32);
  return new Uint8Array(b);
};

const toEvmAddress = (wallet: string) => {
  const trimmed = wallet.trim();
  if (trimmed.startsWith("0x") && trimmed.length === 42) return trimmed;
  if (trimmed.startsWith("0.0.")) return `0x${AccountId.fromString(trimmed).toSolidityAddress()}`;
  return trimmed;
};

const parseHbarToTinybar = (hbar: string | number) => {
  const normalized = typeof hbar === "number" ? String(hbar) : hbar;
  const [wholeRaw, fracRaw = ""] = normalized.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "00000000").slice(0, 8);
  const tiny = BigInt(whole) * BigInt("100000000") + BigInt(frac === "" ? "0" : frac);
  if (tiny <= BigInt("0")) throw new Error("Invalid amount_hbar");
  return tiny.toString();
};

const getOperatorEvmAddress = () => `0x${AccountId.fromString(mustGetEnv("HEDERA_ACCOUNT_ID")).toSolidityAddress()}`;

const exec = async (input: { functionName: string; params: ContractFunctionParameters; gas?: number; payableHbar?: string }) => {
  if (isSimulation()) {
    return { txHash: `sim_contract_${input.functionName}_${Date.now()}` };
  }

  const client = getHederaClient();
  const tx = new ContractExecuteTransaction().setContractId(getVaultContractId()).setGas(input.gas ?? 350_000).setFunction(input.functionName, input.params);
  if (input.payableHbar) tx.setPayableAmount(Hbar.fromString(input.payableHbar));
  const res = await tx.execute(client);
  const receipt = await res.getReceipt(client);
  const status = receipt.status.toString();
  if (status !== "SUCCESS") throw new Error(`Contract call failed (${input.functionName}): ${status}`);
  return { txHash: res.transactionId.toString() };
};

export const vaultRegisterOrder = async (order: DbOrder) => {
  const orderId = memoToBytes32(order.deposit_memo);
  const userWallet = toEvmAddress(order.user_wallet);
  const tokenOut = order.token_target.startsWith("0x") ? order.token_target : "0x0000000000000000000000000000000000000000";
  const mode = order.mode === "swap" ? 0 : 1;
  const amountTinybar = parseHbarToTinybar(order.amount_hbar);

  const params = new ContractFunctionParameters()
    .addBytes32(orderId)
    .addAddress(userWallet)
    .addUint256(new BigNumber(amountTinybar))
    .addAddress(tokenOut)
    .addUint8(mode);

  return exec({ functionName: "registerOrder", params, gas: 450_000 });
};

export const vaultWithdrawForExecution = async (order: DbOrder) => {
  const orderId = memoToBytes32(order.deposit_memo);
  const amountTinybar = parseHbarToTinybar(order.amount_hbar);
  const to = getOperatorEvmAddress();

  const params = new ContractFunctionParameters()
    .addBytes32(orderId)
    .addAddress(to)
    .addUint256(new BigNumber(amountTinybar));

  return exec({ functionName: "withdrawForExecution", params, gas: 450_000 });
};

export const vaultMarkCompleted = async (order: DbOrder) => {
  const params = new ContractFunctionParameters().addBytes32(memoToBytes32(order.deposit_memo));
  return exec({ functionName: "markCompleted", params, gas: 200_000 });
};

export const vaultMarkRefunded = async (order: DbOrder) => {
  const params = new ContractFunctionParameters().addBytes32(memoToBytes32(order.deposit_memo));
  return exec({ functionName: "markRefunded", params, gas: 200_000 });
};
