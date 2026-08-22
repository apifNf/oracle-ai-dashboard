"use client";

import { useState, useEffect } from "react";
import { Save, Key, Wallet, Shield, Check } from "lucide-react";

export default function SettingsPage() {
  // 1. Membuat "Ingatan" (State) untuk menyimpan pilihan
  const [exchange, setExchange] = useState("okx");
  const [environment, setEnvironment] = useState("spot");
  const [openAiKey, setOpenAiKey] = useState("");
  const [exchangeKey, setExchangeKey] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  // 2. Mengambil data dari memori saat halaman pertama kali dibuka
  useEffect(() => {
    const savedExchange = localStorage.getItem("oracle_exchange");
    const savedEnv = localStorage.getItem("oracle_environment");
    const savedOpenAi = localStorage.getItem("oracle_openai_key");
    const savedExchangeKey = localStorage.getItem("oracle_exchange_key");

    if (savedExchange) setExchange(savedExchange);
    if (savedEnv) setEnvironment(savedEnv);
    if (savedOpenAi) setOpenAiKey(savedOpenAi);
    if (savedExchangeKey) setExchangeKey(savedExchangeKey);
  }, []);

  // 3. Fungsi untuk menyimpan data secara permanen saat tombol Save diklik
  const handleSave = () => {
    localStorage.setItem("oracle_exchange", exchange);
    localStorage.setItem("oracle_environment", environment);
    localStorage.setItem("oracle_openai_key", openAiKey);
    localStorage.setItem("oracle_exchange_key", exchangeKey);

    // Memberikan efek visual bahwa data berhasil disimpan
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl relative">
      {/* HEADER */}
      <div>
        <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-zinc-50 transition-colors">Workspace Configuration</h1>
      </div>

      <div className="grid gap-6 mt-8">
        
        {/* EXCHANGE CONFIGURATION */}
        <section className="p-6 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl space-y-5 shadow-sm dark:shadow-none transition-colors duration-500">
          <div className="flex items-center gap-3 border-b border-slate-200 dark:border-zinc-800/50 pb-4 transition-colors">
            <Wallet className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-100 transition-colors">Exchange Connectivity</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">Primary Exchange</label>
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
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">Trading Environment</label>
              <select 
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              >
                <option value="spot">Spot Market</option>
                <option value="futures">Perpetual Futures</option>
              </select>
            </div>
          </div>
        </section>

        {/* API MANAGEMENT */}
        <section className="p-6 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl space-y-5 shadow-sm dark:shadow-none transition-colors duration-500">
          <div className="flex items-center gap-3 border-b border-slate-200 dark:border-zinc-800/50 pb-4 transition-colors">
            <Key className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-100 transition-colors">API Keys & Security</h2>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">ORACLE AI Engine (OpenAI Key)</label>
              <input 
                type="password" 
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                placeholder="sk-..." 
                className="w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono transition-all" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">Exchange API Key (Optional for Read-Only)</label>
              <input 
                type="password" 
                value={exchangeKey}
                onChange={(e) => setExchangeKey(e.target.value)}
                placeholder="Enter API Key" 
                className="w-full p-3 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono transition-all" 
              />
            </div>
          </div>
          
          {/* Security Banner */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 dark:bg-zinc-900/50 dark:border-zinc-800 rounded-lg transition-colors">
            <Shield className="w-5 h-5 text-slate-500 dark:text-zinc-400 flex-shrink-0 transition-colors" />
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors">
              API Keys are securely saved in your browser's local storage. They are never sent to external databases.
            </p>
          </div>
        </section>

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
            {isSaved ? <><Check className="w-4 h-4" /> Configuration Saved!</> : <><Save className="w-4 h-4" /> Save Configuration</>}
          </button>
        </div>
        
      </div>
    </div>
  );
}