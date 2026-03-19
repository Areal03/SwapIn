import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../db/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MirrorTransaction = {
  transaction_id: string;
  consensus_timestamp: string;
  memo_base64?: string;
};

type MirrorAccountResponse = {
  transactions?: MirrorTransaction[];
};

type MirrorContractResponse = {
  contract_id?: string;
};

const decodeMemo = (memoBase64?: string) => {
  if (!memoBase64) return "";
  try {
    return Buffer.from(memoBase64, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
};

export const GET = async () => {
  const mirrorUrl = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
  const rawAddress = process.env.CONTRACT_ADDRESS ?? "";
  if (!rawAddress) return NextResponse.json({ error: "Missing CONTRACT_ADDRESS" }, { status: 500 });

  const vaultKind = (process.env.VAULT_KIND ?? "account").toLowerCase();

  let contractAddress = rawAddress;
  if (vaultKind === "contract" && rawAddress.startsWith("0x")) {
    const contractLookupUrl = `${mirrorUrl}/contracts/${rawAddress}`;
    const contractRes = await fetch(contractLookupUrl, { headers: { accept: "application/json" } });
    if (!contractRes.ok) {
      const body = await contractRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Mirror node error: ${contractRes.status}`, url: contractLookupUrl, details: body },
        { status: 502 }
      );
    }
    const contractJson = (await contractRes.json()) as MirrorContractResponse;
    if (!contractJson.contract_id) {
      return NextResponse.json(
        { error: "Mirror node contract lookup missing contract_id", url: contractLookupUrl, details: contractJson },
        { status: 502 }
      );
    }
    contractAddress = contractJson.contract_id;
  }

  if (vaultKind === "contract" && !/^0\.0\.\d+$/.test(contractAddress)) {
    return NextResponse.json(
      { error: "CONTRACT_ADDRESS must be a Contract ID (0.0.x) or an EVM address (0x...) when VAULT_KIND=contract", value: contractAddress },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: waiting, error: waitingErr } = await supabase
    .from("orders")
    .select("id, deposit_memo")
    .eq("status", "waiting_deposit")
    .limit(200);

  if (waitingErr) return NextResponse.json({ error: waitingErr.message }, { status: 500 });

  const memoToOrderId = new Map<string, string>();
  (waiting ?? []).forEach((o) => memoToOrderId.set(String(o.deposit_memo), String(o.id)));

  const url = new URL(`${mirrorUrl}/accounts/${contractAddress}`);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", "50");

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json({ error: `Mirror node error: ${res.status}`, url: url.toString(), details: body }, { status: 502 });
  }

  const json = (await res.json()) as MirrorAccountResponse;
  const txs = json.transactions ?? [];

  let matched = 0;
  let updated = 0;
  const updates: Array<{ orderId: string; tx: string; memo: string }> = [];

  for (const tx of txs) {
    const memo = decodeMemo(tx.memo_base64);
    const orderId = memoToOrderId.get(memo);
    if (!orderId) continue;
    matched++;

    const { error: updErr } = await supabase
      .from("orders")
      .update({ status: "deposit_detected", tx_hash: tx.transaction_id })
      .eq("id", orderId)
      .eq("status", "waiting_deposit");

    if (!updErr) {
      updated++;
      updates.push({ orderId, tx: tx.transaction_id, memo });
    }
  }

  return NextResponse.json({ scanned: txs.length, waiting: waiting?.length ?? 0, matched, updated, updates });
};
