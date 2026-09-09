"use client";

// FAQSection — accordion minimalis untuk halaman Settings.
//
// Aksesibilitas: setiap pertanyaan adalah <button> di dalam heading, memakai
// aria-expanded + aria-controls, jadi pembaca layar mengumumkan status buka/
// tutup. Panel yang tertutup di-unmount (bukan sekadar disembunyikan) supaya
// isinya tidak ikut terbaca pembaca layar maupun ditemukan Ctrl+F.

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

const FAQ_ITEMS: { q: TranslationKey; a: TranslationKey }[] = [
  { q: "faq.q1", a: "faq.a1" },
  { q: "faq.q2", a: "faq.a2" },
  { q: "faq.q3", a: "faq.a3" },
];

export function FAQSection({ className }: { className?: string }) {
  const t = useTranslation();
  // Accordion satu-terbuka: pertanyaan berikutnya menutup yang sebelumnya,
  // jadi panel tetap ringkas dan tidak mendorong tombol Save jauh ke bawah.
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      className={cn(
        "p-6 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]",
        "rounded-xl space-y-5 shadow-sm dark:shadow-none transition-colors duration-500",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-zinc-800/50 pb-4 transition-colors">
        <HelpCircle className="w-5 h-5 text-emerald-500" />
        <div>
          <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-100 transition-colors">
            {t("faq.title")}
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{t("faq.subtitle")}</p>
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-zinc-800/60 -mt-1">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = openIndex === i;
          const panelId = `faq-panel-${i}`;
          const buttonId = `faq-button-${i}`;
          return (
            <div key={item.q} className="py-1">
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className={cn(
                    "w-full flex items-center justify-between gap-4 py-3 text-left rounded-lg",
                    "text-sm font-medium transition-colors",
                    isOpen
                      ? "text-slate-900 dark:text-zinc-100"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "w-1 h-4 rounded-full shrink-0 transition-colors duration-300",
                        isOpen ? "bg-emerald-500" : "bg-slate-200 dark:bg-zinc-800",
                      )}
                    />
                    {t(item.q)}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "w-4 h-4 shrink-0 text-slate-400 dark:text-zinc-500 transition-transform duration-300",
                      isOpen && "rotate-180 text-emerald-500",
                    )}
                  />
                </button>
              </h3>

              {isOpen && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="pb-4 pl-[1.375rem] pr-8"
                >
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                    {t(item.a)}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
