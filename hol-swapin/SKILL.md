# Swap.In Execution Agent

An intent-based execution agent on Hedera. Users submit a goal (Swap or Snipe), deposit HBAR with a memo, and the agent autonomously monitors, decides, and executes while keeping an auditable transaction trail.

## Why this is an agent

- Sense: watches Hedera deposits via the Mirror Node API (memo matching).
- Think: evaluates a route plan and applies guardrails (slippage/timeout/refund policy).
- Act: executes the swap/snipe workflow and records transaction hashes.
- Explain: streams a step-by-step decision trace in the live console.

## Live demo

- App: https://swap-in.vercel.app/
- Transactions: submit an intent and follow the live console. Deposit/execution/refund hashes are linked to HashScan.

## Capabilities

- Create an intent order (swap/snipe) and return deposit instructions (address + memo).
- Detect deposits by scanning recent Hedera account transactions and matching memo.
- Process ready orders: route → execute → record tx hash; refund on failure.
- Provide transparent progress logs (live console) with HashScan links.

## How to use (API)

Base URL:

- Production: https://swap-in.vercel.app

### 1) Create an order

`POST /api/create-order`

Request body:

```json
{
  "user_wallet": "0.0.1234",
  "mode": "swap",
  "token_target": "USDC",
  "amount_hbar": "10"
}
```

Response (example shape):

```json
{
  "order": {
    "id": "uuid",
    "user_wallet": "0.0.1234",
    "mode": "swap",
    "token_target": "USDC",
    "amount_hbar": "10",
    "deposit_memo": "swap_72181",
    "status": "waiting_deposit",
    "tx_hash": null,
    "created_at": "2026-03-19T00:00:00.000Z"
  },
  "deposit": {
    "contract_address": "0.0.x",
    "memo": "swap_72181",
    "amount_hbar": "10"
  }
}
```

User action:

- Send `amount_hbar` HBAR to `deposit.contract_address` with memo `deposit.memo`.

### 2) Detect deposits

`GET /api/check-deposits`

What it does:

- Fetches recent transactions for the configured deposit account/contract.
- Decodes `memo_base64` and matches it to `orders.deposit_memo`.
- Updates matching orders to `deposit_detected` and stores the deposit `tx_hash`.

### 3) Execute orders

`GET /api/process-orders`

What it does:

- Picks orders where `status = deposit_detected`.
- Sets `executing`, runs swap/snipe execution, and updates:
  - `completed` with execution tx hash, or
  - `refunded`/`failed` on errors.

## Safety & trust model (MVP)

- No wallet connect prompts in the UI (reduces signature phishing risk).
- Memo-based deposit correlation (auditable via Mirror Node).
- Execution guardrails: slippage/timeout/refund policy (MVP-level).
- Semi-custodial during execution: the agent temporarily controls funds while fulfilling the intent.
