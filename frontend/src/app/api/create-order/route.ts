import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../../../db/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  user_wallet: z.string().min(3),
  mode: z.enum(["swap", "snipe"]),
  token_target: z.string().min(1),
  amount_hbar: z.string().regex(/^\d+(\.\d+)?$/)
});

const makeMemo = (mode: "swap" | "snipe") => {
  const n = crypto.randomInt(10000, 100000);
  return `${mode}_${n}`;
};

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const depositAddress = process.env.CONTRACT_ADDRESS ?? "";
  if (!depositAddress) return NextResponse.json({ error: "Missing CONTRACT_ADDRESS" }, { status: 500 });

  const supabase = getSupabaseAdmin();
  const id = crypto.randomUUID();
  const deposit_memo = makeMemo(parsed.data.mode);

  const { data, error } = await supabase
    .from("orders")
    .insert({
      id,
      user_wallet: parsed.data.user_wallet,
      mode: parsed.data.mode,
      token_target: parsed.data.token_target,
      amount_hbar: parsed.data.amount_hbar,
      deposit_memo,
      status: "waiting_deposit",
      tx_hash: null
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    order: data,
    deposit: { contract_address: depositAddress, memo: deposit_memo, amount_hbar: parsed.data.amount_hbar }
  });
};
