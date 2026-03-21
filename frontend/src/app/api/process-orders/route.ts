import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../db/supabaseAdmin";
import { refundHbar } from "../../../lib/hedera";
import { executeSwap } from "../../../lib/swap";
import { executeSnipe } from "../../../lib/snipe";
import { DbOrder } from "../../../lib/types";
import { isVaultContractMode, vaultMarkCompleted, vaultMarkRefunded, vaultRefundRemaining, vaultRegisterOrder, vaultWithdrawForExecution } from "../../../lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  const supabase = getSupabaseAdmin();

  const { data: orders, error } = await supabase.from("orders").select("*").eq("status", "deposit_detected").limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const processed: Array<{ id: string; status: string; tx_hash?: string | null; error?: string }> = [];

  for (const raw of (orders ?? []) as DbOrder[]) {
    const { error: lockErr } = await supabase
      .from("orders")
      .update({ status: "executing" })
      .eq("id", raw.id)
      .eq("status", "deposit_detected");

    if (lockErr) {
      processed.push({ id: raw.id, status: "skipped", error: lockErr.message });
      continue;
    }

    try {
      if (isVaultContractMode()) {
        await vaultRegisterOrder(raw);
        await vaultWithdrawForExecution(raw);
      }

      const execRes = raw.mode === "swap" ? await executeSwap(raw) : await executeSnipe(raw);

      if (isVaultContractMode()) {
        await vaultMarkCompleted(raw);
      }

      const { error: doneErr } = await supabase
        .from("orders")
        .update({ status: "completed", tx_hash: execRes.txHash })
        .eq("id", raw.id);

      if (doneErr) throw new Error(doneErr.message);
      processed.push({ id: raw.id, status: "completed", tx_hash: execRes.txHash });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      try {
        if (isVaultContractMode()) {
          try {
            await vaultRefundRemaining(raw);
          } catch {
            await vaultMarkRefunded(raw);
          }
        }
        const refundRes = await refundHbar({ userWallet: raw.user_wallet, amountHbar: raw.amount_hbar });
        await supabase
          .from("orders")
          .update({ status: "refunded", tx_hash: refundRes.txHash })
          .eq("id", raw.id);
        processed.push({ id: raw.id, status: "refunded", tx_hash: refundRes.txHash, error: msg });
      } catch (refundErr) {
        const refundMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
        await supabase
          .from("orders")
          .update({ status: "failed", tx_hash: null })
          .eq("id", raw.id);
        processed.push({ id: raw.id, status: "failed", error: `${msg}; refund failed: ${refundMsg}` });
      }
    }
  }

  return NextResponse.json({ count: processed.length, processed });
};
