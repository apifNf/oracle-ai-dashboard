"use client";

// Pemilih bahasa EN / ID. Tingginya (h-7) sengaja disamakan dengan ThemeToggle
// supaya keduanya sejajar rapi di topbar.

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

export default function LanguageToggle() {
  const { locale, setLocale } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sama seperti ThemeToggle: jangan render sebelum mount supaya markup server
  // (yang selalu bahasa default) tidak bentrok dengan pilihan tersimpan user.
  if (!mounted) return null;

  return (
    <div
      role="group"
      aria-label="Language"
      className="relative flex items-center h-7 p-0.5 rounded-full bg-gray-300 dark:bg-zinc-800 shadow-inner"
    >
      <Languages className="w-3.5 h-3.5 mx-1.5 text-gray-600 dark:text-zinc-400 shrink-0" />
      {LOCALES.map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            onClick={() => setLocale(code)}
            aria-pressed={active}
            className={cn(
              "px-2.5 h-6 rounded-full text-[10px] font-bold tracking-wider transition-all duration-300",
              active
                ? "bg-white/60 dark:bg-black/40 text-slate-900 dark:text-white backdrop-blur-md border border-white/80 dark:border-gray-600/50 shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                : "text-gray-600 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-300",
            )}
          >
            {LOCALE_LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
