"use client";

// TradingStepsBanner — onboarding "cara trading di ORACLE".
//
// Tiga langkah horizontal bergaya glassmorphism ORACLE, bisa ditutup permanen.
//
// HIDRASI: status "sudah ditutup" hanya ada di localStorage, jadi server tidak
// bisa tahu. Render pertama sengaja mengembalikan null di kedua sisi; banner
// baru muncul setelah mount kalau memang belum pernah ditutup. Kalau urutannya
// dibalik (render dulu, sembunyikan belakangan), user yang sudah menutupnya
// akan melihat banner berkedip di setiap muat halaman.

import { useEffect, useState } from "react";
import { KeyRound, Radar, Sparkles, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "hasDismissedOnboarding";

const STEPS: {
  icon: typeof KeyRound;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}[] = [
  { icon: KeyRound, titleKey: "onboarding.step1.title", descKey: "onboarding.step1.desc" },
  { icon: Radar, titleKey: "onboarding.step2.title", descKey: "onboarding.step2.desc" },
  { icon: Sparkles, titleKey: "onboarding.step3.title", descKey: "onboarding.step3.desc" },
];

export function TradingStepsBanner({ className }: { className?: string }) {
  const t = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "true") setVisible(true);
    } catch {
      // Storage diblokir (mode privat): tampilkan saja — banner informatif,
      // bukan sesuatu yang berbahaya kalau muncul lagi.
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 sm:p-6",
        "border-slate-200 bg-white/70 shadow-sm",
        "dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none",
        "backdrop-blur-xl transition-colors duration-500",
        className,
      )}
    >
      {/* Aksen cahaya khas ORACLE di tepi atas */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[2px] rounded-b-full bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
      />

      <button
        onClick={dismiss}
        aria-label={t("onboarding.dismiss")}
        title={t("onboarding.dismiss")}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="pr-8">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-50">
          {t("onboarding.title")}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <ol className="mt-5 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.titleKey}
            className={cn(
              "relative flex flex-col items-center text-center gap-2 px-3",
              // Pemisah vertikal hanya di layar lebar, hanya antar kolom.
              i > 0 && "sm:border-l sm:border-slate-200 sm:dark:border-white/10",
            )}
          >
            <div className="relative flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5 backdrop-blur-md">
              <step.icon className="w-5 h-5 text-emerald-500" />
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]">
                {i + 1}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              {t(step.titleKey)}
            </h3>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400 max-w-[260px]">
              {t(step.descKey)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
