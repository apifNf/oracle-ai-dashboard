"use client";

// Provider i18n ORACLE.
//
// HIDRASI: server tidak tahu bahasa pilihan user (localStorage hanya ada di
// browser), jadi render PERTAMA di klien harus identik dengan server —
// keduanya memakai DEFAULT_LOCALE. Bahasa tersimpan baru diterapkan di
// useEffect setelah mount. Membaca localStorage langsung di useState akan
// memicu hydration mismatch pada user berbahasa Indonesia.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  dictionaries,
  en,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "oracle_locale";
export const LOCALE_EVENT = "oracle:locale-updated";

/** Nilai substitusi untuk placeholder `{nama}` di dalam string kamus. */
export type TranslationVars = Record<string, string | number>;

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  /** false sampai bahasa tersimpan selesai dibaca (hindari flash tak perlu). */
  ready: boolean;
};

const I18nContext = createContext<I18nValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "id";
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      /* mode privat / storage diblokir — tetap pakai default */
    }
    setReady(true);

    // Sinkron antar tab dan antar komponen di tab yang sama.
    const sync = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isLocale(saved)) setLocaleState(saved);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(LOCALE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(LOCALE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event(LOCALE_EVENT));
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => {
      // Fallback berlapis: kamus aktif -> Inggris -> kunci itu sendiri.
      // Kunci mentah yang muncul di layar lebih baik daripada string kosong:
      // bug-nya kelihatan, bukan menghilang diam-diam.
      const table = dictionaries[locale] as Record<string, string>;
      const value = table?.[key] ?? (en as Record<string, string>)[key] ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, ready }),
    [locale, setLocale, t, ready],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n harus dipakai di dalam <I18nProvider>.");
  }
  return ctx;
}

/** Pintasan bagi komponen yang hanya butuh fungsi terjemahan. */
export function useTranslation() {
  return useI18n().t;
}
