import crypto from "node:crypto";
import { IntentOrder, Mode, OrderStatus } from "./types.js";

class OrderNotFoundError extends Error {
  code = "ORDER_NOT_FOUND" as const;
}

const makeOrderId = (mode: Mode) => {
  const suffix = crypto.randomBytes(4).toString("hex");
  const ts = Date.now();
  return `${mode}_order_${ts}_${suffix}`;
};

export class OrderStore {
  private orders = new Map<string, IntentOrder>();

  create(input: { userWallet: string; tokenOut: string; mode: Mode; amountHbar: string }): IntentOrder {
    const id = makeOrderId(input.mode);
    const now = Date.now();
    const order: IntentOrder = {
      id,
      userWallet: input.userWallet,
      tokenOut: input.tokenOut,
      mode: input.mode,
      amountHbar: input.amountHbar,
      status: "WAITING_FOR_DEPOSIT",
      createdAt: now
    };
    this.orders.set(id, order);
    return order;
  }

  get(id: string): IntentOrder | undefined {
    return this.orders.get(id);
  }

  list(): IntentOrder[] {
    return [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  update(id: string, patch: Partial<IntentOrder>): IntentOrder {
    const current = this.orders.get(id);
    if (!current) {
      throw new OrderNotFoundError(`Unknown order: ${id}`);
    }
    const updated: IntentOrder = { ...current, ...patch };
    this.orders.set(id, updated);
    return updated;
  }

  setStatus(id: string, status: OrderStatus, error?: string) {
    this.update(id, { status, error });
  }
}

export const orderStore = new OrderStore();
