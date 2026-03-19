import { logBus } from "../logBus.js";
import { RouteChoice } from "../types.js";

export type ExecutionResult = {
  txId?: string;
  receivedAmount: string;
};

export const executeSwap = async (input: {
  orderId: string;
  route: RouteChoice;
  amountHbar: string;
  tokenOut: string;
  userWallet: string;
}) => {
  logBus.info(`Executing swap on ${input.route.dex}...`, input.orderId);
  await new Promise((r) => setTimeout(r, 1200));
  logBus.info(`Swap successful (simulated)`, input.orderId);
  const result: ExecutionResult = { receivedAmount: input.route.estimatedOut, txId: `sim_swap_${Date.now()}` };
  return result;
};

export const executeSnipeBuy = async (input: {
  orderId: string;
  route: RouteChoice;
  amountHbar: string;
  tokenOut: string;
  userWallet: string;
}) => {
  logBus.info(`Executing snipe buy on ${input.route.dex}...`, input.orderId);
  await new Promise((r) => setTimeout(r, 1200));
  logBus.info(`Buy successful (simulated)`, input.orderId);
  const result: ExecutionResult = { receivedAmount: input.route.estimatedOut, txId: `sim_snipe_${Date.now()}` };
  return result;
};

export const sendTokensToUser = async (input: {
  orderId: string;
  userWallet: string;
  tokenOut: string;
  amountOut: string;
}) => {
  logBus.info(`Sending ${input.amountOut} ${input.tokenOut} to ${input.userWallet}...`, input.orderId);
  await new Promise((r) => setTimeout(r, 800));
  logBus.info(`Transfer complete (simulated)`, input.orderId);
};

