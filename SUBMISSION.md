# Hackathon Submission Pack — Swap.In

## 1) Project GitHub Repo Link

- https://github.com/Areal03/SwapIn

## 2) Project Details

### Project Description (≤ 100 words)

Swap.In is an autonomous intent execution agent on Hedera. Users submit an intent (Swap/Snipe), then deposit HBAR with a memo to a vault contract. The agent monitors the network via Hedera Mirror Node, matches deposits by memo, evaluates execution parameters, and executes the action on a DEX. Progress is streamed in a live console with clickable HashScan links for deposit/execution/refund transactions. This reduces wallet-connect friction and turns complex DeFi flows into a single deposit transaction while keeping the agent’s actions auditable and transparent.

### Selected hackathon track

- AI & Agents

### Tech stack (solutions / infrastructure / services)

- Hedera EVM + HTS (token associations)
- Hedera Mirror Node (deposit detection and audit trail)
- HashScan (transaction verification)
- SaucerSwap V2 SwapRouter + QuoterV2 (testnet)
- Solidity smart contract vault (intent escrow + controlled withdrawals)
- Next.js (App Router) + API Routes (serverless agent endpoints)
- Supabase (Postgres + Realtime) for orders and status streaming
- Vercel (deployment)

## 3) Pitch Deck (PDF)

Source deck (HTML):

- `pitch-deck.html` (print to PDF: Browser → Print → Save as PDF; disable “Headers and footers”)

Output file to upload:

- `SwapIn_PitchDeck.pdf`

Pitch deck must include:

- Team & project introduction
- Project summary aligned to judging criteria
- Future roadmap
- Demo section with YouTube link

## 4) Project Demo Video (≤ 5 minutes)

- YouTube URL: https://youtu.be/PqobcX9M0qc

Recording checklist (suggested flow):

1) Open the app
2) Submit an intent (Testnet + SAUCE)
3) Show deposit instruction and memo
4) Send deposit transaction
5) Run `/api/check-deposits` and `/api/process-orders`
6) Show live console progress + HashScan proof (deposit + execution/refund)

## 5) Project Demo Link (live working environment)

- https://swap-in.vercel.app/

## Bounty (optional)

If submitting to Hashgraph Online (HOL) bounty:

- Skill package folder: `hol-swapin/`
- Files: `SKILL.md`, `skill.json`, `SKILL.manifest.json`
- Goal: make the agent discoverable + provide clear instructions and demo proof links.
