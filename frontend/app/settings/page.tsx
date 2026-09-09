"use client";

import { useState, useEffect } from "react";
import { Save, Key, Wallet, Shield, Check, AlertTriangle } from "lucide-react";
import {
  WORKSPACE_EVENT,
  getExchangeCredentials,
  saveExchangeCredentials,
  requiresPassphrase,
  exchangeLabel,
} from "@/lib/workspace";
import { useTranslation } from "@/lib/i18n/context";
import { FAQSection } from "@/components/settings/faq-section";

export default function SettingsPage() {
  const t = useTranslation();

  // 1. Membuat "Ingatan" (State) untuk menyimpan pilihan
  const [exchange, setExchange] = useState("okx");
  const [environment, setEnvironment] = useState("spot");
  const [openAiKey, setOpenAiKey] = useState("");
  const [exchangeKey, setExchangeKey] = useState("");
  const [exchangeSecret, setExchangeSecret] = useState("");
  const [exchangePassphrase, setExchangePassphrase] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  // 2. Mengambil data dari memori saat halaman pertama kali dibuka
  useEffect(() => {
    const savedExchange = localStorage.getItem("oracle_exchange");
    const savedEnv = localStorage.getItem("oracle_environment");
    const savedOpenAi = localStorage.getItem("oracle_openai_key");
    const creds = getExchangeCredentials();

    if (savedExchange) setExchange(savedExchange);
    if (savedEnv) setEnvironment(savedEnv);
    if (savedOpenAi) setOpenAiKey(savedOpenAi);
    setExchangeKey(creds.api_key);
    setExchangeSecret(creds.secret_key);
    setExchangePassphrase(creds.passphrase);
  }, []);

  // 3. Fungsi untuk menyimpan data secara permanen saat tombol Save diklik
  const handleSave = () => {
    localStorage.setItem("oracle_exchange", exchange);
    localStorage.setItem("oracle_environment", environment);
    localStorage.setItem("oracle_openai_key", openAiKey);
    // API Key + Secret Key + Passphrase disimpan bersama (satu set kredensial).
    saveExchangeCredentials({
      api_key: exchangeKey,
      secret_key: exchangeSecret,
      passphrase: exchangePassphrase,
    });

    // Beri tahu komponen lain (Trade Ticket, dst.) supaya ikut menyesuaikan.
    window.dispatchEvent(new Event(WORKSPACE_EVENT));

    // Memberikan efek visual bahwa data berhasil disimpan
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  // Kelas input dipakai berulang — satu sumber kebenaran, bukan copy-paste.
  const inputClass =
    "w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono transition-all";
  const labelClass =
    "text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors";

  const needsPassphrase = requiresPassphrase(exchange);
  const exLabel = exchangeLabel(exchange);
  // Auto-Trade butuh SEMUA kunci; passphrase hanya untuk bursa tertentu.
  const missing: string[] = [];
  if (!exchangeKey.trim()) missing.push(t("settings.field.apiKey"));
  if (!exchangeSecret.trim()) missing.push(t("settings.field.secretKey"));
  if (needsPassphrase && !exchangePassphrase.trim()) missing.push(t("settings.field.passphrase"));

  return (
    <div className="space-y-6 max-w-4xl relative">
      {/* HEADER */}
      <div>
        <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">{t("settings.eyebrow")}</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-zinc-50 transition-colors">{t("settings.title")}</h1>
      </div>

      <div className="grid gap-6 mt-8">
        
        {/* EXCHANGE CONFIGURATION */}
        <section className="p-6 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl space-y-5 shadow-sm dark:shadow-none transition-colors duration-500">
          <div className="flex items-center gap-3 border-b border-slate-200 dark:border-zinc-800/50 pb-4 transition-colors">
            <Wallet className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-100 transition-colors">{t("settings.exchangeConnectivity")}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">{t("settings.primaryExchange")}</label>
              <select 
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              >
                <option value="okx">OKX</option>
                <option value="mexc">MEXC</option>
                <option value="bybit">Bybit</option>
                <option value="indodax">Indodax</option>
                <option value="binance">Binance</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">{t("settings.tradingEnvironment")}</label>
              <select 
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              >
                <option value="spot">{t("settings.spotMarket")}</option>
                <option value="futures">{t("settings.perpetualFutures")}</option>
              </select>
            </div>
          </div>
        </section>

        {/* API MANAGEMENT */}
        <section className="p-6 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl space-y-5 shadow-sm dark:shadow-none transition-colors duration-500">
          <div className="flex items-center gap-3 border-b border-slate-200 dark:border-zinc-800/50 pb-4 transition-colors">
            <Key className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-100 transition-colors">{t("settings.apiKeysSecurity")}</h2>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className={labelClass}>{t("settings.openAiLabel")}</label>
              <input
                type="password"
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                placeholder="sk-..."
                className={inputClass}
              />
            </div>

            {/* --- Kredensial Auto-Trade: ketiganya satu set --- */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 transition-colors">
                  {t("settings.credentials.title", { exchange: exLabel })}
                </h3>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                    missing.length === 0
                      ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                      : "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10"
                  }`}
                >
                  {missing.length === 0
                    ? t("settings.credentials.ready")
                    : t("settings.credentials.missing", { fields: missing.join(", ") })}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors">
                {t("settings.credentials.helpBefore")}{" "}
                <strong>{t("settings.credentials.helpStrong")}</strong>{" "}
                {t("settings.credentials.helpAfter")}
              </p>
            </div>

            <div className="space-y-2">
              <label className={labelClass}>{t("settings.apiKey")}</label>
              <input
                type="password"
                value={exchangeKey}
                onChange={(e) => setExchangeKey(e.target.value)}
                placeholder={t("settings.apiKeyPlaceholder")}
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>{t("settings.secretKey")}</label>
              <input
                type="password"
                value={exchangeSecret}
                onChange={(e) => setExchangeSecret(e.target.value)}
                placeholder={t("settings.secretKeyPlaceholder")}
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>
                {t("settings.passphrase")}
                {needsPassphrase && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    {t("settings.passphraseRequired", { exchange: exLabel })}
                  </span>
                )}
              </label>
              <input
                type="password"
                value={exchangePassphrase}
                onChange={(e) => setExchangePassphrase(e.target.value)}
                placeholder={needsPassphrase
                  ? t("settings.passphraseRequiredPlaceholder")
                  : t("settings.passphraseOptionalPlaceholder")}
                autoComplete="off"
                className={inputClass}
              />
            </div>
          </div>

          {/* Security Banner */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 dark:bg-zinc-900/50 dark:border-zinc-800 rounded-lg transition-colors">
            <Shield className="w-5 h-5 text-slate-500 dark:text-zinc-400 flex-shrink-0 transition-colors" />
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors">
              <strong>{t("settings.security.strong")}</strong> {t("settings.security.body")}
            </p>
          </div>

          {/* Peringatan hak akses kunci — ini yang menentukan kerugian maksimum
              kalau perangkat/browser user disusupi. */}
          <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/30 rounded-lg transition-colors">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed transition-colors">
              {t("settings.warning.body", {
                trade: t("settings.warning.trade"),
                withdraw: t("settings.warning.withdraw"),
              })}
            </p>
          </div>
        </section>

        {/* FAQ — di bawah kotak konfigurasi API */}
        <FAQSection />

        {/* SAVE BUTTON */}
        <div className="flex justify-end pt-4">
          <button 
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 font-semibold rounded-lg transition-all duration-300 shadow-sm dark:shadow-none ${
              isSaved 
                ? "bg-emerald-600 text-white" 
                : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-zinc-100 dark:text-black dark:hover:bg-white"
            }`}
          >
            {isSaved ? <><Check className="w-4 h-4" /> {t("settings.saved")}</> : <><Save className="w-4 h-4" /> {t("settings.save")}</>}
          </button>
        </div>
        
      </div>
    </div>
  );
}