import { logBus } from "../logBus.js";

export type LiquiditySignal = {
  detectedAt: number;
  source: "simulated";
};

export const waitForLiquidity = async (input: { orderId: string; tokenOut: string; timeoutMs: number }) => {
  logBus.info(`Liquidity monitor started for ${input.tokenOut}`, input.orderId);

  const jitterMs = 3000 + Math.floor(Math.random() * 9000);
  const waitMs = Math.min(jitterMs, input.timeoutMs);

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), waitMs);
    const abort = setTimeout(() => reject(new Error("timeout")), input.timeoutMs);
    (t as unknown as { unref?: () => void }).unref?.();
    (abort as unknown as { unref?: () => void }).unref?.();
  });

  logBus.info(`Liquidity detected for ${input.tokenOut}`, input.orderId);
  return { detectedAt: Date.now(), source: "simulated" as const } satisfies LiquiditySignal;
};
