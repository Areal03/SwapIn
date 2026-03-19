import { DbOrder } from "./types";
import { isSimulation, sleep } from "./hedera";
import { executeSwap } from "./swap";

export const executeSnipe = async (order: DbOrder) => {
  if (isSimulation()) {
    const waitMs = 2000 + Math.floor(Math.random() * 5000);
    await sleep(waitMs);
    await sleep(1200);
    return { txHash: `sim_snipe_${order.deposit_memo}_${Date.now()}` };
  }

  const waitMs = Number(process.env.SNIPE_MAX_WAIT_MS ?? 60_000);
  const jitter = 2000 + Math.floor(Math.random() * 4000);
  await sleep(Math.min(waitMs, 10_000 + jitter));
  return executeSwap(order);
};
