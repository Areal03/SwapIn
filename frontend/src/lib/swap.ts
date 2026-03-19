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

const toEvmAddress = (wallet: string) => {
  const trimmed = wallet.trim();
  if (trimmed.startsWith("0x") && trimmed.length === 42) return trimmed.toLowerCase();
  if (trimmed.startsWith("0.0.")) return `0x${AccountId.fromString(trimmed).toSolidityAddress()}`;
  return trimmed;
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

const resolveTokenOut = async (tokenTarget: string, amountInTinybar: string) => {
  const raw = tokenTarget.trim();
  if (raw.startsWith("0x") && raw.length === 42) return { kind: "evm" as const, evm: raw.toLowerCase(), tokenId: null as string | null };
  if (raw.startsWith("0.0.")) return { kind: "tokenId" as const, evm: toEvmAddressFromTokenId(raw), tokenId: raw };

  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  if (raw.toUpperCase() === "SAUCE") {
    const tokenId = network === "mainnet" ? "0.0.731861" : "0.0.1183558";
    return { kind: "tokenId" as const, evm: toEvmAddressFromTokenId(tokenId), tokenId };
  }

  if (raw.toUpperCase() === "USDC") {
    const mirrorUrl = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
    const tokensRes = await fetch(`${mirrorUrl.replace(/\/$/, "")}/tokens?name=USDC&limit=25`, { headers: { accept: "application/json" } });
    const tokensJson = (await tokensRes.json()) as { tokens?: Array<{ token_id: string }> };
    const candidates = (tokensJson.tokens ?? []).map((t) => t.token_id).filter(Boolean).slice(0, 15);
    if (candidates.length === 0) throw new Error("USDC not found on mirror node");

    const whbarEvm = `0x${ContractId.fromString(network === "mainnet" ? "0.0.1456985" : "0.0.15057").toSolidityAddress()}`;
    const quoterId = network === "mainnet" ? "0.0.3949424" : "0.0.1390002";
    const quoterEvm = `0x${ContractId.fromString(quoterId).toSolidityAddress()}`;
    const iface = new Interface([
      "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
    ]);
    const mirrorBase = mirrorUrl.replace(/\/$/, "");
    const feeCandidates = [3000, 500, 10000];

    for (const tokenId of candidates) {
      const tokenEvm = toEvmAddressFromTokenId(tokenId);
      for (const fee of feeCandidates) {
        try {
          const path = buildPath(whbarEvm, fee, tokenEvm);
          const data = iface.encodeFunctionData("quoteExactInput", [path, amountInTinybar]);
          const rawResult = await mirrorContractCall({ mirrorUrl: mirrorBase, toEvmAddress: quoterEvm, data });
          const decoded = iface.decodeFunctionResult("quoteExactInput", rawResult) as unknown as { amountOut: bigint };
          const out = decoded.amountOut;
          if (out && out > BigInt("0")) return { kind: "tokenId" as const, evm: tokenEvm, tokenId };
        } catch {
          continue;
        }
      }
    }

    throw new Error("No liquid USDC route found on testnet");
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
  } catch {
    return;
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

  const whbarContractId = network === "mainnet" ? "0.0.1456985" : "0.0.15057";
  const whbarEvm = `0x${ContractId.fromString(whbarContractId).toSolidityAddress()}`;

  const amountInTinybar = parseHbarToTinybar(order.amount_hbar);
  const out = await resolveTokenOut(order.token_target, amountInTinybar);

  await ensureAssociatedIfOperatorRecipient({ recipient: order.user_wallet, tokenId: out.tokenId });

  const recipientEvm = toEvmAddress(order.user_wallet);
  const quoterContractId = network === "mainnet" ? "0.0.3949424" : "0.0.1390002";
  const quoterEvm = `0x${ContractId.fromString(quoterContractId).toSolidityAddress()}`;
  const fee = Number(process.env.SWAP_FEE ?? 3000);
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
  const response = await new ContractExecuteTransaction()
    .setPayableAmount(Hbar.fromTinybars(amountInTinybar))
    .setContractId(routerId)
    .setGas(Number(process.env.SWAP_GAS ?? 900_000))
    .setFunctionParameters(multicallBytes)
    .execute(client);

  const record = await response.getRecord(client);
  return { txHash: record.transactionId.toString() };
};
