import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { logBus } from "./logBus.js";
import { orderStore } from "./orderStore.js";
import { executionAgent } from "./agent/executionAgent.js";

const intentSchema = z.object({
  userWallet: z.string().min(3),
  mode: z.enum(["swap", "snipe"]),
  tokenOut: z.string().min(3),
  amountHbar: z.string().regex(/^\d+(\.\d+)?$/)
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/intents", (req, res) => {
  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid intent", details: parsed.error.flatten() });

  const order = orderStore.create(parsed.data);
  logBus.info("Waiting for deposit...", order.id);

  return res.json({
    order,
    deposit: {
      to: config.vaultContractId,
      amountHbar: order.amountHbar,
      memo: order.id
    }
  });
});

app.get("/api/orders", (_req, res) => res.json({ orders: orderStore.list() }));

app.get("/api/orders/:id", (req, res) => {
  const order = orderStore.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  return res.json({ order });
});

app.get("/api/logs/recent", (req, res) => {
  const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;
  return res.json({ logs: logBus.listRecent(orderId) });
});

app.get("/api/logs/stream", (req, res) => {
  const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  const write = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  logBus.listRecent(orderId).forEach((l) => write(l));

  const unsub = logBus.onLog((entry) => {
    if (orderId && entry.orderId !== orderId) return;
    write(entry);
  });

  req.on("close", () => {
    unsub();
    res.end();
  });
});

app.listen(config.port, () => {
  logBus.info(`API listening on :${config.port}`);
  executionAgent.start();
});

