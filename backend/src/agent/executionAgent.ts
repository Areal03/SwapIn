import { config } from "../config.js";
import { logBus } from "../logBus.js";
import { orderStore } from "../orderStore.js";
import { pollDeposits } from "../mirrorNode.js";
import { chooseBestRoute } from "../dex/routeOptimizer.js";
import { waitForLiquidity } from "../dex/liquidityMonitor.js";
import { executeSnipeBuy, executeSwap, sendTokensToUser } from "./executor.js";

export class ExecutionAgent {
  private timer?: NodeJS.Timeout;
  private lastConsensusTimestamp?: string;
  private processedTx = new Set<string>();
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    logBus.info(`Agent started (${config.simulation ? "simulation" : "live"} mode)`);
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick().catch((e) => logBus.error(String(e))), config.pollIntervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private async tick() {
    const knownOrderIds = new Set(orderStore.list().map((o) => o.id));
    const deposits = await pollDeposits(knownOrderIds, this.lastConsensusTimestamp);

    if (deposits.length > 0) {
      const newest = deposits.reduce((a, b) => (a.consensusTimestamp > b.consensusTimestamp ? a : b));
      this.lastConsensusTimestamp = newest.consensusTimestamp;
    }

    for (const dep of deposits) {
      if (this.processedTx.has(dep.transactionId)) continue;
      this.processedTx.add(dep.transactionId);
      await this.handleDeposit(dep.orderId, dep);
    }

    this.schedule();
  }

  private async handleDeposit(orderId: string, dep: { transactionId: string; consensusTimestamp: string; payer?: string; amountTinybar: string }) {
    const order = orderStore.get(orderId);
    if (!order) return;

    if (order.status !== "WAITING_FOR_DEPOSIT") return;

    orderStore.update(orderId, {
      status: "DEPOSIT_DETECTED",
      deposit: {
        consensusTimestamp: dep.consensusTimestamp,
        transactionId: dep.transactionId,
        payer: dep.payer,
        amountTinybar: dep.amountTinybar
      }
    });

    logBus.info("Deposit detected", orderId, dep);

    try {
      if (order.mode === "swap") {
        await this.executeSwapOrder(orderId);
      } else {
        await this.executeSnipeOrder(orderId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      orderStore.setStatus(orderId, "FAILED", msg);
      logBus.error(`Order failed: ${msg}`, orderId);
    }
  }

  private async executeSwapOrder(orderId: string) {
    const order = orderStore.get(orderId);
    if (!order) return;

    orderStore.setStatus(orderId, "EXECUTING");
    logBus.info(`Order type: SWAP`, orderId);
    logBus.info("Evaluating routes...", orderId);

    const { candidates, best } = chooseBestRoute({ orderId, amountHbar: order.amountHbar, tokenOut: order.tokenOut });
    candidates.forEach((c) => logBus.info(`Route candidate: ${c.dex} -> estOut ${c.estimatedOut}`, orderId));
    logBus.info(`Best route: ${best.dex}`, orderId);
    orderStore.update(orderId, { route: best });

    const swapRes = await executeSwap({
      orderId,
      route: best,
      amountHbar: order.amountHbar,
      tokenOut: order.tokenOut,
      userWallet: order.userWallet
    });

    await sendTokensToUser({
      orderId,
      userWallet: order.userWallet,
      tokenOut: order.tokenOut,
      amountOut: swapRes.receivedAmount
    });

    orderStore.setStatus(orderId, "COMPLETED");
    logBus.info("Order completed.", orderId);
  }

  private async executeSnipeOrder(orderId: string) {
    const order = orderStore.get(orderId);
    if (!order) return;

    orderStore.setStatus(orderId, "EXECUTING");
    logBus.info(`Order type: SNIPE`, orderId);

    await waitForLiquidity({ orderId, tokenOut: order.tokenOut, timeoutMs: 60_000 });

    logBus.info("Evaluating routes...", orderId);
    const { best } = chooseBestRoute({ orderId, amountHbar: order.amountHbar, tokenOut: order.tokenOut });
    orderStore.update(orderId, { route: best });
    logBus.info(`Best route: ${best.dex}`, orderId);

    const buyRes = await executeSnipeBuy({
      orderId,
      route: best,
      amountHbar: order.amountHbar,
      tokenOut: order.tokenOut,
      userWallet: order.userWallet
    });

    await sendTokensToUser({
      orderId,
      userWallet: order.userWallet,
      tokenOut: order.tokenOut,
      amountOut: buyRes.receivedAmount
    });

    orderStore.setStatus(orderId, "COMPLETED");
    logBus.info("Order completed.", orderId);
  }
}

export const executionAgent = new ExecutionAgent();
