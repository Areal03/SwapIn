export type OrderMode = "swap" | "snipe";

export type OrderStatus =
  | "waiting_deposit"
  | "deposit_detected"
  | "executing"
  | "completed"
  | "failed"
  | "refunded";

export type DbOrder = {
  id: string;
  user_wallet: string;
  mode: OrderMode;
  token_target: string;
  amount_hbar: string;
  deposit_memo: string;
  status: OrderStatus;
  tx_hash: string | null;
  created_at: string;
};

