"use client";

import { useEffect, useState } from "react";
import { Crown, Check, Loader2, Bitcoin, Zap } from "lucide-react";
import { GlassModal } from "@/components/ui/glass-modal";
import {
  createCharge,
  fetchBillingConfig,
  type BillingConfig,
} from "@/lib/billing";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

// Kunci kamus, bukan teks jadi — daftar ini dirender ulang saat bahasa ganti.
const BENEFIT_KEYS: TranslationKey[] = [
  "billing.benefit.prompts",
  "billing.benefit.strategy",
  "billing.benefit.intel",
  "billing.benefit.quant",
  "billing.benefit.scanner",
  "billing.benefit.autotrade",
];

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: string;
  email?: string | null;
  onToast?: (kind: "success" | "error" | "info", title: string, detail?: string) => void;
};

export function UpgradeToProModal({ open, onClose, accountId, email, onToast }: Props) {
  const t = useTranslation();
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
        res.mock ? t("billing.toast.sandbox") : t("billing.toast.opening"),
        `Charge ${res.code ?? res.charge_id}`,
      );
      // Mock: navigasi relatif ke origin saat ini (bukan URL absolut backend).
      // Coinbase asli: pakai hosted_url apa adanya.
      window.location.href = res.mock
        ? `/billing/mock?charge=${encodeURIComponent(res.charge_id)}`
        : res.checkout_url;
    } catch (e) {
      onToast?.("error", t("billing.toast.failed"), e instanceof Error ? e.message : "unknown");
      setLoading(false);
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={t("billing.title")}
      icon={<Crown className="w-4 h-4 text-amber-400" />}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-white/10 py-2.5 px-4 text-sm font-medium text-zinc-400 hover:text-white hover:border-white/20 transition disabled:opacity-50"
          >
            {t("billing.later")}
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
            {loading ? t("billing.preparing") : t("billing.payCta", { price })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">${price}</span>
          <span className="text-sm text-zinc-500">
            {t("billing.period", { days: config?.period_days ?? 30 })}
          </span>
        </div>

        <ul className="space-y-2">
          {BENEFIT_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm text-zinc-300">
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              {t(key)}
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {t("billing.multiChain")}{" "}
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
