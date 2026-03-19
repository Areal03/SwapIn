import crypto from "node:crypto";
import { RouteChoice } from "../types.js";

const pseudoQuote = (seed: string, amountHbar: string) => {
  const h = crypto.createHash("sha256").update(`${seed}:${amountHbar}`).digest();
  const n = h.readUInt32BE(0);
  const base = Number(amountHbar);
  const multiplier = 0.9 + (n % 2000) / 10000;
  const est = base * multiplier;
  return est.toFixed(6);
};

export const chooseBestRoute = (input: { orderId: string; amountHbar: string; tokenOut: string }) => {
  const saucerOut = pseudoQuote(`saucerswap:${input.tokenOut}`, input.amountHbar);
  const heliOut = pseudoQuote(`heliswap:${input.tokenOut}`, input.amountHbar);

  const best: RouteChoice =
    Number(saucerOut) >= Number(heliOut)
      ? { dex: "SaucerSwap", estimatedOut: saucerOut, path: ["HBAR", input.tokenOut] }
      : { dex: "HeliSwap", estimatedOut: heliOut, path: ["HBAR", input.tokenOut] };

  return {
    candidates: [
      { dex: "SaucerSwap" as const, estimatedOut: saucerOut, path: ["HBAR", input.tokenOut] },
      { dex: "HeliSwap" as const, estimatedOut: heliOut, path: ["HBAR", input.tokenOut] }
    ],
    best
  };
};

