import { DbOrder } from "./types";
import { isSimulation, sleep } from "./hedera";

export const executeSwap = async (order: DbOrder) => {
  if (isSimulation()) {
    await sleep(1200);
    return { txHash: `sim_swap_${order.deposit_memo}_${Date.now()}` };
  }

  throw new Error("executeSwap live mode not implemented");
};
