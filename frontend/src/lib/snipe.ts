import { DbOrder } from "./types";
import { isSimulation, sleep } from "./hedera";

export const executeSnipe = async (order: DbOrder) => {
  if (isSimulation()) {
    const waitMs = 2000 + Math.floor(Math.random() * 5000);
    await sleep(waitMs);
    await sleep(1200);
    return { txHash: `sim_snipe_${order.deposit_memo}_${Date.now()}` };
  }

  throw new Error("executeSnipe live mode not implemented");
};
