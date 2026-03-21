# Swap.In — Hedera Intent-Based DeFi Agent (AI & Agents)

Swap.In is an intent-first execution agent on Hedera. Users submit an intent (Swap / Snipe), deposit HBAR with a memo, and the agent detects the deposit, executes the action, and records transaction hashes for auditability.

- Live demo: https://swap-in.vercel.app/
- Repo: https://github.com/Areal03/SwapIn
- Track: AI & Agents

## What you get (MVP)

- No wallet connect flow: user deposits HBAR to a vault using a memo.
- Autonomous agent loop: detect deposits → execute → refund on failure.
- Transparent progress: live console + HashScan links.

## Project structure

- `frontend/` — Next.js app + API routes (order creation, deposit check, order processing)
- `contracts/` — Solidity vault contract + deployment scripts
- `hol-swapin/` — HOL skill package files (`SKILL.md`, `skill.json`, manifest)

## Prerequisites

- Node.js 18+ (recommended)
- A Supabase project (Postgres + Service Role key)
- Hedera testnet account funded with HBAR
- Receiver wallet should associate the output token (HTS) before swapping

## Setup (local)

1) Install dependencies

```bash
cd frontend
npm install
```

2) Create env file

Copy the example and fill values:

```bash
copy .env.example .env.local
```

Required (minimum for running the app):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL_POOLER` (or your Supabase connection string)
- `CONTRACT_ADDRESS` (vault contract id, e.g. `0.0.x`)
- `VAULT_KIND=contract`
- `MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com/api/v1`
- `HEDERA_NETWORK=testnet`
- `HEDERA_ACCOUNT_ID`
- `HEDERA_PRIVATE_KEY` (ECDSA `0x...`)
- `DEX_ROUTER_ADDRESS=0.0.1414040` (SaucerSwap V2 SwapRouter testnet)

3) Create DB table

Run the SQL in:

- `frontend/supabase/orders.sql`

4) Run dev server

```bash
cd frontend
npm run dev
```

Open:

- http://localhost:3000

## How to demo (recommended)

1) Pick **Testnet** + **SAUCE**.
2) Set **Receiver Address** to your Hedera account id (e.g. `0.0.x`).
3) Make sure the receiver has associated SAUCE token id:

- SAUCE (testnet): `0.0.1183558`

4) Click **Submit Intent**, then deposit HBAR to the shown vault contract id with the memo.
5) Trigger processing:

- `/api/check-deposits`
- `/api/process-orders`

## Deploy (Vercel)

This is a monorepo. In Vercel project settings:

- Root Directory: `frontend`
- Framework Preset: `Next.js`

Set the same env vars in Vercel Environment Variables (do not commit secrets).

## Troubleshooting

- `No liquid USDC route found on testnet`: testnet may not have a usable USDC pool. Use SAUCE or provide the exact token id via Custom.
- `SwapRouter failed ... CONTRACT_REVERT_EXECUTED`: most commonly receiver has not associated the output token.
- `vault.withdrawForExecution ... TransferFailed`: the agent/vault address mapping is incorrect; ensure you deployed the vault with the correct agent EVM alias and updated `CONTRACT_ADDRESS`.

## License

MIT
