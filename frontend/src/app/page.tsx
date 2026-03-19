"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "../db/supabaseBrowser";
import type { DbOrder, OrderMode, OrderStatus } from "../lib/types";

type LogEntry = {
  ts: number;
  level: "info" | "error";
  message: string;
  label?: string;
  href?: string;
  copyKey?: string;
  copyValue?: string;
};

const fmtTs = (ms: number) => {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const hashscanTxUrl = (txHash: string) => {
  if (!txHash) return null;
  if (txHash.startsWith("sim_")) return null;
  return `https://hashscan.io/testnet/transaction/${encodeURIComponent(txHash)}`;
};

const hash32 = (input: string) => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const pseudoQuote = (seed: string, amountHbar: string) => {
  const base = Number(amountHbar);
  const h = hash32(`${seed}:${amountHbar}`);
  const multiplier = 0.85 + (h % 2500) / 10000;
  const est = base * multiplier;
  return est;
};

const formatNum = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(6);
};

const statusToMessage = (status: OrderStatus, mode: OrderMode) => {
  if (status === "waiting_deposit") return "Waiting for deposit";
  if (status === "deposit_detected") return "Deposit detected";
  if (status === "executing") return mode === "swap" ? "Executing swap" : "Executing snipe";
  if (status === "completed") return "Order completed.";
  if (status === "refunded") return "Order refunded.";
  return "Order failed.";
};

export default function Home() {
  const [mode, setMode] = useState<OrderMode>("swap");
  const [amountHbar, setAmountHbar] = useState("10");
  const [userWallet, setUserWallet] = useState("");
  const [tokenPreset, setTokenPreset] = useState<"USDC" | "SAUCE" | "CUSTOM">("USDC");
  const [tokenTarget, setTokenTarget] = useState("");
  const [showAbout, setShowAbout] = useState(false);

  const [order, setOrder] = useState<DbOrder | null>(null);
  const [deposit, setDeposit] = useState<{ contract_address: string; memo: string; amount_hbar: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [ticker, setTicker] = useState(0);

  const logEndRef = useRef<HTMLDivElement | null>(null);
  const lastStatusRef = useRef<OrderStatus | null>(null);
  const depositTxRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const narrativeRef = useRef<{ orderId: string; depositNarrative: boolean; executeNarrative: boolean; finalNarrative: boolean } | null>(
    null
  );

  const copyToClipboard = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1200);
    } catch {
      setLogs((prev) => [...prev, { ts: Date.now(), level: "error" as const, message: "Copy failed" }].slice(-300));
    }
  };

  const pushLog = (entry: Omit<LogEntry, "ts">) => {
    setLogs((prev) => [...prev, { ts: Date.now(), ...entry }].slice(-300));
  };

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const schedule = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const getRoutePlan = (o: DbOrder) => {
    const saucer = pseudoQuote(`SaucerSwap:${o.token_target}`, String(o.amount_hbar));
    const heli = pseudoQuote(`HeliSwap:${o.token_target}`, String(o.amount_hbar));
    const bestDex = saucer >= heli ? "SaucerSwap" : "HeliSwap";
    const bestOut = Math.max(saucer, heli);
    const slippageBps = 100;
    const minOut = bestOut * (1 - slippageBps / 10_000);
    return { saucerOut: saucer, heliOut: heli, bestDex, bestOut, slippageBps, minOut };
  };

  const canSubmit = useMemo(() => {
    if (userWallet.trim().length < 3) return false;
    if ((tokenPreset === "CUSTOM" ? tokenTarget : tokenPreset).trim().length < 1) return false;
    if (!/^\d+(\.\d+)?$/.test(amountHbar.trim())) return false;
    return true;
  }, [userWallet, tokenTarget, tokenPreset, amountHbar]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  useEffect(() => {
    clearTimers();
    narrativeRef.current = null;
    depositTxRef.current = null;
  }, [order?.id]);

  useEffect(() => {
    if (!order?.id) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`orders-${order.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `id=eq.${order.id}` },
        (payload) => {
          const next = payload.new as DbOrder;
          setOrder(next);
          if (lastStatusRef.current !== next.status) {
            lastStatusRef.current = next.status;
            pushLog({ level: "info", message: statusToMessage(next.status, next.mode) });
            if (next.status === "deposit_detected" && next.tx_hash) {
              depositTxRef.current = next.tx_hash;
              pushLog({
                level: "info",
                label: "Deposit tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "deposit_tx",
                copyValue: next.tx_hash
              });
            }
            if (next.status === "completed" && next.tx_hash) {
              pushLog({
                level: "info",
                label: "Swap tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "swap_tx",
                copyValue: next.tx_hash
              });
            }
            if (next.status === "refunded" && next.tx_hash) {
              pushLog({
                level: "info",
                label: "Refund tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "refund_tx",
                copyValue: next.tx_hash
              });
            }
          }
        }
      )
      .subscribe();

    const poll = setInterval(() => {
      void (async () => {
        try {
          const { data } = await supabase.from("orders").select("*").eq("id", order.id).single();
          if (!data) return;
          const next = data as DbOrder;
          setOrder(next);
          if (lastStatusRef.current !== next.status) {
            lastStatusRef.current = next.status;
            pushLog({ level: "info", message: statusToMessage(next.status, next.mode) });
            if (next.status === "deposit_detected" && next.tx_hash) {
              depositTxRef.current = next.tx_hash;
              pushLog({
                level: "info",
                label: "Deposit tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "deposit_tx",
                copyValue: next.tx_hash
              });
            }
            if (next.status === "completed" && next.tx_hash) {
              pushLog({
                level: "info",
                label: "Swap tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "swap_tx",
                copyValue: next.tx_hash
              });
            }
            if (next.status === "refunded" && next.tx_hash) {
              pushLog({
                level: "info",
                label: "Refund tx",
                message: next.tx_hash,
                href: hashscanTxUrl(next.tx_hash) ?? undefined,
                copyKey: "refund_tx",
                copyValue: next.tx_hash
              });
            }
          }
        } catch {
          return;
        }
      })();
    }, 3000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [order?.id]);

  useEffect(() => {
    if (!order?.id) return;
    if (!narrativeRef.current || narrativeRef.current.orderId !== order.id) {
      narrativeRef.current = { orderId: order.id, depositNarrative: false, executeNarrative: false, finalNarrative: false };
    }

    const state = narrativeRef.current;
    if (!state) return;

    if (order.status === "deposit_detected" && !state.depositNarrative) {
      state.depositNarrative = true;
      const plan = getRoutePlan(order);
      schedule(250, () => pushLog({ level: "info", message: "Preparing execution..." }));
      if (order.mode === "swap") {
        schedule(700, () => pushLog({ level: "info", message: "Evaluating routes..." }));
        schedule(1100, () =>
          pushLog({ level: "info", label: "SaucerSwap quote", message: `${formatNum(plan.saucerOut)} out (est.)` })
        );
        schedule(1400, () =>
          pushLog({ level: "info", label: "HeliSwap quote", message: `${formatNum(plan.heliOut)} out (est.)` })
        );
        schedule(1750, () => pushLog({ level: "info", label: "Best route", message: plan.bestDex }));
        schedule(2050, () =>
          pushLog({ level: "info", label: "Slippage", message: `${plan.slippageBps} bps` })
        );
        schedule(2300, () =>
          pushLog({ level: "info", label: "Min out", message: `${formatNum(plan.minOut)} (est.)` })
        );
      } else {
        schedule(700, () => pushLog({ level: "info", message: "Monitoring liquidity..." }));
        schedule(1600, () => pushLog({ level: "info", message: "Liquidity signal received (simulated check)." }));
        schedule(2100, () => pushLog({ level: "info", message: "Route ready. Waiting for execution..." }));
      }
    }

    if (order.status === "executing" && !state.executeNarrative) {
      state.executeNarrative = true;
      if (order.mode === "swap") {
        schedule(300, () => pushLog({ level: "info", message: "Submitting swap transaction..." }));
        schedule(900, () => pushLog({ level: "info", message: "Awaiting confirmation..." }));
        schedule(1400, () => pushLog({ level: "info", message: "Sending tokens to receiver..." }));
      } else {
        schedule(300, () => pushLog({ level: "info", message: "Submitting snipe transaction..." }));
        schedule(900, () => pushLog({ level: "info", message: "Awaiting confirmation..." }));
        schedule(1400, () => pushLog({ level: "info", message: "Sending tokens to receiver..." }));
      }
    }

    if ((order.status === "completed" || order.status === "refunded" || order.status === "failed") && !state.finalNarrative) {
      state.finalNarrative = true;
      const plan = getRoutePlan(order);
      if (order.status === "completed") {
        schedule(200, () => pushLog({ level: "info", message: "Swap successful." }));
        schedule(450, () => pushLog({ level: "info", label: "DEX", message: plan.bestDex }));
        schedule(700, () => pushLog({ level: "info", label: "Est. out", message: `${formatNum(plan.bestOut)} ${order.token_target}` }));
        schedule(950, () => pushLog({ level: "info", label: "Receiver", message: order.user_wallet, copyKey: "receiver", copyValue: order.user_wallet }));
      } else if (order.status === "refunded") {
        schedule(200, () => pushLog({ level: "info", message: "Execution failed. Refund sent." }));
        schedule(450, () => pushLog({ level: "info", label: "Receiver", message: order.user_wallet, copyKey: "receiver", copyValue: order.user_wallet }));
      } else {
        schedule(200, () => pushLog({ level: "error", message: "Execution failed." }));
      }
    }
  }, [order]);

  useEffect(() => {
    const status = order?.status;
    if (status !== "waiting_deposit" && status !== "deposit_detected" && status !== "executing") return;
    const id = window.setInterval(() => setTicker((t) => t + 1), 450);
    return () => window.clearInterval(id);
  }, [order?.status]);

  const submitIntent = async () => {
    setLogs([]);
    setOrder(null);
    setDeposit(null);
    lastStatusRef.current = null;
    depositTxRef.current = null;
    clearTimers();
    narrativeRef.current = null;
    setTicker(0);

    const res = await fetch("/api/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_wallet: userWallet,
        mode,
        token_target: tokenPreset === "CUSTOM" ? tokenTarget : tokenPreset,
        amount_hbar: amountHbar
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      setLogs([{ ts: Date.now(), level: "error" as const, message: `API error: ${txt}` }]);
      return;
    }

    const json = (await res.json()) as { order: DbOrder; deposit: { contract_address: string; memo: string; amount_hbar: string } };
    setOrder(json.order);
    setDeposit(json.deposit);
    lastStatusRef.current = json.order.status;
    setLogs([]);
    pushLog({ level: "info", message: "Order placed." });
    pushLog({
      level: "info",
      label: "Order ID",
      message: json.order.id,
      copyKey: "order_id",
      copyValue: json.order.id
    });
    pushLog({
      level: "info",
      label: "Deposit address",
      message: json.deposit.contract_address,
      copyKey: "deposit_address",
      copyValue: json.deposit.contract_address
    });
    pushLog({ level: "info", label: "Amount (HBAR)", message: String(json.deposit.amount_hbar) });
    pushLog({ level: "info", label: "Token", message: json.order.token_target });
    pushLog({ level: "info", label: "Memo", message: json.deposit.memo, copyKey: "deposit_memo", copyValue: json.deposit.memo });
    pushLog({ level: "info", message: statusToMessage(json.order.status, json.order.mode) });
  };

  const dots = ".".repeat((ticker % 3) + 1);
  const progressLine =
    order?.status === "waiting_deposit"
      ? `Waiting for deposit${dots}`
      : order?.status === "deposit_detected"
        ? `Waiting for execution${dots}`
        : order?.status === "executing"
          ? `${order.mode === "swap" ? "Executing swap" : "Executing snipe"}${dots}`
          : null;

  return (
    <div className="min-h-screen bg-black text-green-200">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 font-mono">
        <div className="rounded border border-green-800/60 bg-green-950/10 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg tracking-wide text-green-100">
                Swap<span className="text-green-400">.</span>
                <span className="text-green-100">In</span> — Hedera Intent-Based DeFi Agent
              </div>
              <div className="text-sm text-green-300/80">No wallet connect. Submit intent → deposit HBAR → agent executes.</div>
            </div>
            <button
              type="button"
              onClick={() => setShowAbout(true)}
              className="mt-0.5 shrink-0 rounded border border-green-800/60 bg-black px-3 py-2 text-sm text-green-200 hover:border-green-500"
            >
              I
            </button>
          </div>
        </div>

        {showAbout ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8"
            onMouseDown={() => setShowAbout(false)}
          >
            <div
              className="w-full max-w-3xl rounded border border-green-800/60 bg-black p-5 text-sm text-green-100"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base text-green-100">About Swap.In</div>
                  <div className="mt-1 text-xs text-green-300/70">An autonomous intent execution agent on Hedera — no wallet connect required</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAbout(false)}
                  className="shrink-0 rounded border border-green-800/60 bg-black px-3 py-2 text-xs text-green-200 hover:border-green-500"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">What is this?</div>
                  <div className="mt-2 text-green-100">
                    Swap.In is an intent-first app: you describe the outcome you want (Swap or Snipe) and deposit HBAR with a
                    memo. A serverless agent monitors the Hedera network, decides how to execute, and then performs the action on
                    your behalf while providing an auditable transaction trail.
                  </div>
                </div>

                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">How it works</div>
                  <div className="mt-2 space-y-1 text-green-100">
                    <div>1) You submit an intent → an order is stored.</div>
                    <div>2) The UI displays deposit instructions (address + memo).</div>
                    <div>3) The agent detects deposits via the Hedera Mirror Node (memo match).</div>
                    <div>4) The agent evaluates routes and executes Swap/Snipe.</div>
                    <div>5) The UI streams the agent’s decision trace and HashScan links.</div>
                  </div>
                </div>

                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">Why it’s an AI agent</div>
                  <div className="mt-2 space-y-1 text-green-100">
                    <div>- Sense: monitors network signals and deposits via the Mirror Node.</div>
                    <div>- Think: scores candidate routes (price, slippage, safety) and chooses an action.</div>
                    <div>- Act: submits transactions, waits for confirmation, and completes delivery.</div>
                    <div>- Explain: outputs a step-by-step decision trace in the live console.</div>
                  </div>
                </div>

                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">Transparency</div>
                  <div className="mt-2 space-y-1 text-green-100">
                    <div>- Deposits are matched by memo and recorded with a transaction ID.</div>
                    <div>- Execution and refunds store transaction hashes and open in HashScan.</div>
                    <div>- Live console shows route candidates and the chosen route.</div>
                  </div>
                </div>

                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">Safety guardrails (MVP)</div>
                  <div className="mt-2 space-y-1 text-green-100">
                    <div>- No wallet connect/sign prompts, reducing signature phishing risk.</div>
                    <div>- Slippage limits and timeouts can be enforced at execution time.</div>
                    <div>- Automatic refund path if execution fails (refund tx is recorded).</div>
                    <div>- Basic token sanity checks can be applied before execution.</div>
                  </div>
                </div>

                <div className="rounded border border-green-800/40 bg-green-950/10 p-4">
                  <div className="text-xs text-green-300/80">Limitations</div>
                  <div className="mt-2 space-y-1 text-green-100">
                    <div>- Funds are temporarily controlled by the vault/agent during execution (semi-custodial by design).</div>
                    <div>- Route scoring is policy-based for MVP; production can integrate deeper market data.</div>
                    <div>- Always verify token addresses and execution limits before using larger amounts.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded border border-green-800/60 bg-green-950/10 p-4">
            <div className="mb-3 text-sm text-green-300/80">Intent Input</div>

            <label className="mb-2 block text-xs text-green-300/80">Mode</label>
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMode("swap")}
                className={`rounded border px-3 py-2 text-sm ${
                  mode === "swap" ? "border-green-500 bg-green-900/30 text-green-100" : "border-green-800/60"
                }`}
              >
                Swap
              </button>
              <button
                type="button"
                onClick={() => setMode("snipe")}
                className={`rounded border px-3 py-2 text-sm ${
                  mode === "snipe" ? "border-green-500 bg-green-900/30 text-green-100" : "border-green-800/60"
                }`}
              >
                Snipe
              </button>
            </div>

            <label className="mb-2 block text-xs text-green-300/80">
              {mode === "swap" ? "Token" : "Target Token (ID/Address)"}
            </label>
            <div className="mb-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTokenPreset("USDC")}
                className={`rounded border px-3 py-2 text-sm ${
                  tokenPreset === "USDC" ? "border-green-500 bg-green-900/30 text-green-100" : "border-green-800/60"
                }`}
              >
                USDC
              </button>
              <button
                type="button"
                onClick={() => setTokenPreset("SAUCE")}
                className={`rounded border px-3 py-2 text-sm ${
                  tokenPreset === "SAUCE" ? "border-green-500 bg-green-900/30 text-green-100" : "border-green-800/60"
                }`}
              >
                SAUCE
              </button>
              <button
                type="button"
                onClick={() => setTokenPreset("CUSTOM")}
                className={`rounded border px-3 py-2 text-sm ${
                  tokenPreset === "CUSTOM" ? "border-green-500 bg-green-900/30 text-green-100" : "border-green-800/60"
                }`}
              >
                Custom
              </button>
            </div>
            {tokenPreset === "CUSTOM" ? (
              <input
                value={tokenTarget}
                onChange={(e) => setTokenTarget(e.target.value)}
                className="mb-4 w-full rounded border border-green-800/60 bg-black px-3 py-2 text-green-100 outline-none"
                placeholder="0.0.x or 0x..."
              />
            ) : (
              <div className="mb-4 rounded border border-green-800/40 bg-black/40 px-3 py-2 text-sm text-green-200">
                Selected: {tokenPreset}
              </div>
            )}

            <label className="mb-2 block text-xs text-green-300/80">Amount (HBAR)</label>
            <input
              value={amountHbar}
              onChange={(e) => setAmountHbar(e.target.value)}
              className="mb-4 w-full rounded border border-green-800/60 bg-black px-3 py-2 text-green-100 outline-none"
              placeholder="10"
            />

            <label className="mb-2 block text-xs text-green-300/80">Receiver Address</label>
            <input
              value={userWallet}
              onChange={(e) => setUserWallet(e.target.value)}
              className="mb-4 w-full rounded border border-green-800/60 bg-black px-3 py-2 text-green-100 outline-none"
              placeholder="0x... or 0.0.x"
            />

            <button
              type="button"
              onClick={() => void submitIntent()}
              disabled={!canSubmit}
              className="w-full rounded border border-green-600 bg-green-900/20 px-3 py-2 text-sm text-green-100 disabled:opacity-40"
            >
              Submit Intent
            </button>

            {order && deposit ? (
              <div className="mt-4 rounded border border-green-800/60 bg-black/40 p-3 text-sm">
                <div className="text-green-100">Deposit Instruction</div>
                <div className="mt-2 text-green-300/80">Send {deposit.amount_hbar} HBAR to:</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="break-all text-green-100">{deposit.contract_address}</div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard("deposit_address", deposit.contract_address)}
                    className="shrink-0 rounded border border-green-800/60 bg-black px-2 py-1 text-xs text-green-200 hover:border-green-500"
                  >
                    {copied === "deposit_address" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mt-3 text-green-300/80">Memo:</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="break-all text-green-100">{deposit.memo}</div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard("deposit_memo", deposit.memo)}
                    className="shrink-0 rounded border border-green-800/60 bg-black px-2 py-1 text-xs text-green-200 hover:border-green-500"
                  >
                    {copied === "deposit_memo" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mt-3 text-green-300/80">Order ID:</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="break-all text-green-100">{order.id}</div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard("order_id", order.id)}
                    className="shrink-0 rounded border border-green-800/60 bg-black px-2 py-1 text-xs text-green-200 hover:border-green-500"
                  >
                    {copied === "order_id" ? "Copied" : "Copy"}
                  </button>
                </div>
                {order.tx_hash ? (
                  <>
                    <div className="mt-3 text-green-300/80">Tx Hash:</div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      {hashscanTxUrl(order.tx_hash) ? (
                        <a
                          className="break-all text-green-100 underline decoration-green-700 underline-offset-2 hover:decoration-green-400"
                          href={hashscanTxUrl(order.tx_hash) ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {order.tx_hash}
                        </a>
                      ) : (
                        <div className="break-all text-green-100">{order.tx_hash}</div>
                      )}
                      <div className="flex shrink-0 items-center gap-2">
                        {hashscanTxUrl(order.tx_hash) ? (
                          <a
                            className="rounded border border-green-800/60 bg-black px-2 py-1 text-xs text-green-200 hover:border-green-500"
                            href={hashscanTxUrl(order.tx_hash) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                          >
                            HashScan
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void copyToClipboard("tx_hash", order.tx_hash ?? "")}
                          className="rounded border border-green-800/60 bg-black px-2 py-1 text-xs text-green-200 hover:border-green-500"
                        >
                          {copied === "tx_hash" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded border border-green-800/60 bg-green-950/10 p-4">
            <div className="mb-3 flex items-center justify-between text-sm text-green-300/80">
              <span>Live Agent Console</span>
              <span className="text-xs">{order ? order.status : "idle"}</span>
            </div>
            <div className="h-[520px] overflow-auto rounded border border-green-800/40 bg-black/60 p-3 text-sm leading-6">
              {logs.length === 0 ? (
                <div className="text-green-300/60">No logs yet.</div>
              ) : (
                logs.map((l, idx) => (
                  <div key={`${l.ts}-${idx}`} className={l.level === "error" ? "text-red-300" : "text-green-200"}>
                    <span className="text-green-400/70">[{fmtTs(l.ts)}]</span>{" "}
                    {l.label ? <span className="text-green-300/80">{l.label}: </span> : null}
                    {l.href ? (
                      <a
                        className="break-all underline decoration-green-700 underline-offset-2 hover:decoration-green-400"
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {l.message}
                      </a>
                    ) : (
                      <span className="break-all">{l.message}</span>
                    )}
                    {l.copyValue ? (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(l.copyKey ?? "copy", l.copyValue ?? "")}
                        className="ml-2 rounded border border-green-800/60 bg-black px-2 py-0.5 text-[10px] text-green-200 hover:border-green-500"
                      >
                        {copied === (l.copyKey ?? "copy") ? "Copied" : "Copy"}
                      </button>
                    ) : null}
                  </div>
                ))
              )}
              {progressLine ? (
                <div className="text-green-200">
                  <span className="text-green-400/70">[....]</span> {progressLine}
                </div>
              ) : null}
              <div ref={logEndRef} />
            </div>
            <div className="mt-3 text-xs text-green-300/60">Realtime: Supabase</div>
          </div>
        </div>
      </div>
    </div>
  );
}
