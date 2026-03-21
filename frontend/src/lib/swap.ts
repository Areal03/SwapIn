import { Interface } from "ethers";
import {
  AccountId,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  TokenAssociateTransaction,
  TokenId
} from "@hashgraph/sdk";
import { DbOrder } from "./types";
import { getHederaClient, isSimulation, sleep } from "./hedera";

const mustGetEnv = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

const toEvmAddressFromAccountId = (accountId: string) => `0x${AccountId.fromString(accountId).toSolidityAddress()}`;

const accountEvmCache = new Map<string, string>();

const resolveAccountEvmAddress = async (accountId: string) => {
  const cached = accountEvmCache.get(accountId);
  if (cached) return cached;

  const mirrorUrl = (process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1").replace(/\/$/, "");
  try {
    const res = await fetch(`${mirrorUrl}/accounts/${accountId}`, { headers: { accept: "application/json" } });
    if (res.ok) {
      const json = (await res.json()) as { evm_address?: string };
      const evm = (json.evm_address ?? "").trim().toLowerCase();
      if (evm.startsWith("0x") && evm.length === 42) {
        accountEvmCache.set(accountId, evm);
        return evm;
      }
    }
  } catch {
    //
  }

  const fallback = toEvmAddressFromAccountId(accountId).toLowerCase();
  accountEvmCache.set(accountId, fallback);
  return fallback;
};

const toEvmAddress = async (wallet: string) => {
  const trimmed = wallet.trim();
  if (trimmed.startsWith("0x") && trimmed.length === 42) return trimmed.toLowerCase();
  if (trimmed.startsWith("0.0.")) return resolveAccountEvmAddress(trimmed);
  return trimmed.toLowerCase();
};

const resolveAccountIdFromWallet = async (wallet: string) => {
  const trimmed = wallet.trim();
  if (trimmed.startsWith("0.0.")) return trimmed;
  if (trimmed.startsWith("0x") && trimmed.length === 42) {
    const mirrorUrl = (process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1").replace(/\/$/, "");
    const res = await fetch(`${mirrorUrl}/accounts/${trimmed.toLowerCase()}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { account?: string };
    return typeof json.account === "string" ? json.account : null;
  }
  return null;
};

const isAssociated = async (accountId: string, tokenId: string) => {
  const mirrorUrl = (process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1").replace(/\/$/, "");
  const url = `${mirrorUrl}/accounts/${accountId}/tokens?token.id=${encodeURIComponent(tokenId)}&limit=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return false;
  const json = (await res.json()) as { tokens?: unknown[] };
  return Array.isArray(json.tokens) && json.tokens.length > 0;
};

const toEvmAddressFromTokenId = (tokenId: string) => `0x${TokenId.fromString(tokenId).toSolidityAddress()}`;

const parseHbarToTinybar = (hbar: string | number) => {
  const normalized = typeof hbar === "number" ? String(hbar) : hbar;
  const [wholeRaw, fracRaw = ""] = normalized.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "00000000").slice(0, 8);
  const tiny = BigInt(whole) * BigInt("100000000") + BigInt(frac === "" ? "0" : frac);
  if (tiny <= BigInt("0")) throw new Error("Invalid amount_hbar");
  return tiny.toString();
};

const hexToUint8Array = (hex: string) => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  return out;
};

const feeHex = (fee: number) => fee.toString(16).padStart(6, "0");

const buildPath = (inputEvm: string, fee: number, outputEvm: string) => {
  const a = inputEvm.toLowerCase().replace(/^0x/, "");
  const b = outputEvm.toLowerCase().replace(/^0x/, "");
  return `0x${a}${feeHex(fee)}${b}`;
};

const mirrorContractCall = async (input: { mirrorUrl: string; toEvmAddress: string; data: string }) => {
  const url = `${input.mirrorUrl.replace(/\/$/, "")}/contracts/call`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ block: "latest", to: input.toEvmAddress, data: input.data })
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Mirror contract call failed (${res.status}): ${txt}`);
  const json = JSON.parse(txt) as { result?: string };
  if (!json.result) throw new Error("Mirror contract call missing result");
  return json.result;
};

const quoteExactInput = async (input: {
  mirrorUrl: string;
  quoterEvm: string;
  whbarEvm: string;
  tokenOutEvm: string;
  fee: number;
  amountInTinybar: string;
}) => {
  const iface = new Interface([
    "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
  ]);
  const path = buildPath(input.whbarEvm, input.fee, input.tokenOutEvm);
  const data = iface.encodeFunctionData("quoteExactInput", [path, input.amountInTinybar]);
  const rawResult = await mirrorContractCall({ mirrorUrl: input.mirrorUrl, toEvmAddress: input.quoterEvm, data });
  const decoded = iface.decodeFunctionResult("quoteExactInput", rawResult) as unknown as { amountOut: bigint };
  const out = decoded.amountOut;
  return { amountOut: out ?? BigInt("0"), path };
};

const resolveTokenOut = async (tokenTarget: string, amountInTinybar: string) => {
  const raw = tokenTarget.trim();
  if (raw.startsWith("0x") && raw.length === 42) return { kind: "evm" as const, evm: raw.toLowerCase(), tokenId: null as string | null, fee: null as number | null };
  if (raw.startsWith("0.0.")) return { kind: "tokenId" as const, evm: toEvmAddressFromTokenId(raw), tokenId: raw, fee: null as number | null };

  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  const mirrorUrl = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
  const mirrorBase = mirrorUrl.replace(/\/$/, "");
  const quoterId = network === "mainnet" ? "0.0.3949424" : "0.0.1390002";
  const quoterEvm = `0x${ContractId.fromString(quoterId).toSolidityAddress()}`;
  const whbarTokenId = network === "mainnet" ? "0.0.1456986" : "0.0.15058";
  const whbarEvm = `0x${TokenId.fromString(whbarTokenId).toSolidityAddress()}`;
  const feeCandidates = [500, 3000, 10_000];

  if (raw.toUpperCase() === "SAUCE") {
    const tokenId = network === "mainnet" ? "0.0.731861" : "0.0.1183558";
    const tokenEvm = toEvmAddressFromTokenId(tokenId);

    let bestFee: number | null = null;
    let bestOut = BigInt("0");
    for (const fee of feeCandidates) {
      try {
        const q = await quoteExactInput({ mirrorUrl: mirrorBase, quoterEvm, whbarEvm, tokenOutEvm: tokenEvm, fee, amountInTinybar });
        if (q.amountOut > bestOut) {
          bestOut = q.amountOut;
          bestFee = fee;
        }
      } catch {
        continue;
      }
    }
    if (!bestFee || bestOut <= BigInt("0")) throw new Error("No SAUCE route found");
    return { kind: "tokenId" as const, evm: tokenEvm, tokenId, fee: bestFee };
  }

  if (raw.toUpperCase() === "USDC") {
    const tokensRes = await fetch(`${mirrorUrl.replace(/\/$/, "")}/tokens?name=USDC&limit=25`, { headers: { accept: "application/json" } });
    const tokensJson = (await tokensRes.json()) as { tokens?: Array<{ token_id: string }> };
    const candidates = (tokensJson.tokens ?? []).map((t) => t.token_id).filter(Boolean).slice(0, 15);
    if (candidates.length === 0) throw new Error("USDC not found on mirror node");

    let best: { tokenId: string; tokenEvm: string; fee: number; out: bigint } | null = null;
    for (const tokenId of candidates) {
      const tokenEvm = toEvmAddressFromTokenId(tokenId);
      for (const fee of feeCandidates) {
        try {
          const q = await quoteExactInput({ mirrorUrl: mirrorBase, quoterEvm, whbarEvm, tokenOutEvm: tokenEvm, fee, amountInTinybar });
          if (q.amountOut > BigInt("0") && (!best || q.amountOut > best.out)) {
            best = { tokenId, tokenEvm, fee, out: q.amountOut };
          }
        } catch {
          continue;
        }
      }
    }

    if (!best) throw new Error("No liquid USDC route found on testnet");
    return { kind: "tokenId" as const, evm: best.tokenEvm, tokenId: best.tokenId, fee: best.fee };
  }

  throw new Error(`Unknown token_target: ${raw}`);
};

const ensureAssociatedIfOperatorRecipient = async (input: { recipient: string; tokenId: string | null }) => {
  if (!input.tokenId) return;
  const operatorId = process.env.HEDERA_ACCOUNT_ID ?? "";
  if (!operatorId) return;
  if (input.recipient.trim() !== operatorId.trim()) return;

  const client = getHederaClient();
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(operatorId))
      .setTokenIds([TokenId.fromString(input.tokenId)])
      .freezeWith(client)
      .execute(client);
    await tx.getReceipt(client);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) return;
    throw new Error(`Token association failed (${input.tokenId}): ${msg}`);
  }
};

export const executeSwap = async (order: DbOrder) => {
  if (isSimulation()) {
    await sleep(1200);
    return { txHash: `sim_swap_${order.deposit_memo}_${Date.now()}` };
  }

  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  const mirrorUrl = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";

  const routerContractId = mustGetEnv("DEX_ROUTER_ADDRESS");
  const routerId = ContractId.fromString(routerContractId);

  const whbarTokenId = network === "mainnet" ? "0.0.1456986" : "0.0.15058";
  const whbarEvm = `0x${TokenId.fromString(whbarTokenId).toSolidityAddress()}`;

  const amountInTinybar = parseHbarToTinybar(order.amount_hbar);
  const out = await resolveTokenOut(order.token_target, amountInTinybar);

  await ensureAssociatedIfOperatorRecipient({ recipient: order.user_wallet, tokenId: out.tokenId });

  const recipientEvm = await toEvmAddress(order.user_wallet);
  const quoterContractId = network === "mainnet" ? "0.0.3949424" : "0.0.1390002";
  const quoterEvm = `0x${ContractId.fromString(quoterContractId).toSolidityAddress()}`;
  const fee = Number(out.fee ?? process.env.SWAP_FEE ?? 3000);
  const slippageBps = Number(process.env.SWAP_SLIPPAGE_BPS ?? 100);
  const deadline = Math.floor(Date.now() / 1000) + Number(process.env.SWAP_DEADLINE_SECONDS ?? 600);

  const quoterIface = new Interface([
    "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
  ]);
  const quotePath = buildPath(whbarEvm, fee, out.evm);
  const quoteData = quoterIface.encodeFunctionData("quoteExactInput", [quotePath, amountInTinybar]);
  const quoteRaw = await mirrorContractCall({ mirrorUrl: mirrorUrl.replace(/\/$/, ""), toEvmAddress: quoterEvm, data: quoteData });
  const quoteDecoded = quoterIface.decodeFunctionResult("quoteExactInput", quoteRaw) as unknown as { amountOut: bigint };
  const amountOut = quoteDecoded.amountOut;
  if (!amountOut || amountOut <= BigInt("0")) throw new Error("Quote returned zero output");
  const minOut = (amountOut * BigInt(10_000 - slippageBps)) / BigInt("10000");

  const routerIface = new Interface([
    "function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
    "function refundETH() payable",
    "function multicall(bytes[] data) payable returns (bytes[] results)"
  ]);
  const params = {
    path: quotePath,
    recipient: recipientEvm,
    deadline,
    amountIn: amountInTinybar,
    amountOutMinimum: minOut.toString()
  };
  const swapEncoded = routerIface.encodeFunctionData("exactInput", [params]);
  const refundEncoded = routerIface.encodeFunctionData("refundETH", []);
  const multicallEncoded = routerIface.encodeFunctionData("multicall", [[swapEncoded, refundEncoded]]);
  const multicallBytes = hexToUint8Array(multicallEncoded);

  const client = getHederaClient();
  const payableTinybar = Number(amountInTinybar);
  const tx = new ContractExecuteTransaction()
    .setPayableAmount(Hbar.fromTinybars(payableTinybar))
    .setContractId(routerId)
    .setGas(Number(process.env.SWAP_GAS ?? 1_600_000))
    .setFunctionParameters(multicallBytes);

  const response = await tx.execute(client);
  const txId = response.transactionId.toString();
  try {
    const receipt = await response.getReceipt(client);
    const status = receipt.status.toString();
    if (status !== "SUCCESS") throw new Error(`SwapRouter failed: ${status} tx=${txId}`);
    return { txHash: txId };
  } catch (e) {
    let reason = "";
    try {
      const record = await response.getRecord(client);
      reason = record.contractFunctionResult?.errorMessage ?? "";
    } catch {
      reason = "";
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `SwapRouter failed: ${msg}${reason ? ` (${reason})` : ""} tx=${txId} recipient=${recipientEvm} fee=${fee} tokenOut=${out.tokenId ?? out.evm}`
    );
  }
};

export const preflightSwap = async (order: DbOrder) => {
  if (isSimulation()) return;
  const amountInTinybar = parseHbarToTinybar(order.amount_hbar);
  const out = await resolveTokenOut(order.token_target, amountInTinybar);
  if (!out.tokenId) return;

  const accountId = await resolveAccountIdFromWallet(order.user_wallet);
  if (!accountId) return;

  const operatorId = (process.env.HEDERA_ACCOUNT_ID ?? "").trim();
  if (operatorId && accountId === operatorId) return;

  const ok = await isAssociated(accountId, out.tokenId);
  if (!ok) {
    throw new Error(`Receiver ${accountId} is not associated with token ${out.tokenId}. Associate the token first, then retry.`);
  }
};
