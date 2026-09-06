"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Bitcoin, Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { mockConfirmCharge } from "@/lib/billing";

function MockCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const chargeId = params.get("charge") || "";
  const [state, setState] = useState<"idle" | "paying" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const pay = async () => {
    setState("paying");
    try {
      await mockConfirmCharge(chargeId);
      setState("done");
      setTimeout(() => router.push("/ai-chat?upgraded=1"), 1400);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Gagal");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0A0A0A]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e1015]/85 backdrop-blur-xl p-6 shadow-2xl text-zinc-200">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Sandbox Checkout
          </span>
        </div>
        <h1 className="text-xl font-semibold text-white">ORACLE PRO — $49.00</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Coinbase Commerce API key belum dikonfigurasi — ini simulasi lokal alur pembayaran
          USDC/USDT. Charge <span className="font-mono text-zinc-400">{chargeId || "—"}</span>.
        </p>

        {state === "done" ? (
          <div className="mt-6 flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            Pembayaran terkonfirmasi — akun di-upgrade ke PRO. Mengalihkan…
          </div>
        ) : (
          <>
            <button
              onClick={pay}
              disabled={!chargeId || state === "paying"}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 hover:from-emerald-400 hover:to-amber-400 py-3 font-semibold text-black shadow-lg transition disabled:opacity-60"
            >
              {state === "paying" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Bitcoin className="w-4 h-4" />
              )}
              {state === "paying" ? "Mengonfirmasi…" : "Simulasikan Pembayaran USDC"}
            </button>
            {state === "error" && (
              <p className="mt-3 text-xs text-rose-400">{msg}</p>
            )}
            <button
              onClick={() => router.push("/ai-chat?upgrade=cancelled")}
              className="mt-3 w-full text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Batalkan
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0A]" />}>
      <MockCheckout />
    </Suspense>
  );
}
