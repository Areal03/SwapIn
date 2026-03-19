export type Mode = "swap" | "snipe";

export type OrderStatus =
  | "CREATED"
  | "WAITING_FOR_DEPOSIT"
  | "DEPOSIT_DETECTED"
  | "EXECUTING"
  | "COMPLETED"
  | "REFUNDED"
  | "FAILED";

export type RouteChoice = {
  dex: "SaucerSwap" | "HeliSwap";
  estimatedOut: string;
  path: string[];
};

export type IntentOrder = {
  id: string;
  userWallet: string;
  tokenOut: string;
  mode: Mode;
  amountHbar: string;
  status: OrderStatus;
  createdAt: number;
  deposit?: {
    consensusTimestamp: string;
    transactionId: string;
    payer?: string;
    amountTinybar: string;
  };
  route?: RouteChoice;
  error?: string;
};

