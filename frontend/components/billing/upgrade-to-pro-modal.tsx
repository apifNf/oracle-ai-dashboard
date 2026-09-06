"use client";

import { useEffect, useState } from "react";
import { Crown, Check, Loader2, Bitcoin, Zap } from "lucide-react";
import { GlassModal } from "@/components/ui/glass-modal";
import {
  createCharge,
  fetchBillingConfig,
  type BillingConfig,
} from "@/lib/billing";

const BENEFITS = [
  "Unlimited FABLE 5 Prompts (with Actionable Trader's Take)",
  "Deep Actionable Strategy & Trader's Take (bukan sekadar data)",
  "Real-Time Market Intel (Live CryptoCompare News, Macro Economic Calendar, & Hardcore Whale Terminal)",
  "Prioritas model quant Opus (claude-opus-5)",
  "Live Signal Scanner Alerts",
  "Autotrade Engine (paper + live guardrails)",
];

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: string;
  email?: string | null;
  onToast?: (kind: "success" | "error" | "info", title: string, detail?: string) => void;
};

export function UpgradeToProModal({ open, onClose, accountId, email, onToast }: Props) {
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) fetchBillingConfig().then(setConfig);
  }, [open]);

  const price = config?.price_usd ?? "49.00";

  const startCheckout = async () => {
    setLoading(true);
    try {
      const res = await createCharge(accountId, email);
      onToast?.(
        "info",
        res.mock ? "Mode sandbox — checkout simulasi" : "Membuka checkout Coinbase…",
        `Charge ${res.code ?? res.charge_id}`,
      );
      // Mock: navigasi relatif ke origin saat ini (bukan URL absolut backend).
      // Coinbase asli: pakai hosted_url apa adanya.
      window.location.href = res.mock
        ? `/billing/mock?charge=${encodeURIComponent(res.charge_id)}`
        : res.checkout_url;
    } catch (e) {
      onToast?.("error", "Gagal membuat charge", e instanceof Error ? e.message : "unknown");
      setLoading(false);
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Upgrade ke ORACLE PRO"
      icon={<Crown className="w-4 h-4 text-amber-400" />}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-white/10 py-2.5 px-4 text-sm font-medium text-zinc-400 hover:text-white hover:border-white/20 transition disabled:opacity-50"
          >
            Nanti
          </button>
          <button
            onClick={startCheckout}
            disabled={loading}
            className="flex-[1.6] inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 hover:from-emerald-400 hover:to-amber-400 py-2.5 px-4 font-semibold text-black shadow-lg transition disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Bitcoin className="w-4 h-4" />
            )}
            {loading ? "Menyiapkan…" : `Bayar $${price} via Crypto (USDC/USDT)`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">${price}</span>
          <span className="text-sm text-zinc-500">/ bulan · {config?.period_days ?? 30} hari</span>
          {config?.mock_mode && (
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Sandbox
            </span>
          )}
        </div>

        <ul className="space-y-2">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-zinc-300">
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              {b}
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          Bayar stablecoin multi-chain:{" "}
          <span className="text-zinc-300">
            {(config?.accepted_networks ?? ["base", "polygon", "ethereum", "solana"])
              .map((n) => n[0].toUpperCase() + n.slice(1))
              .join(" · ")}
          </span>
        </div>
      </div>
    </GlassModal>
  );
}
