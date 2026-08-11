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
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-sm uppercase tracking-[0.24em] text-zinc-400">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold">Workspace Configuration</h1>
      </div>

      <div className="grid gap-6 mt-8">
        {/* Exchange Configuration */}
        <section className="p-6 border border-zinc-800 bg-[#09090b] rounded-xl space-y-5">
          <div className="flex items-center gap-3 border-b border-zinc-800/50 pb-4">
            <Wallet className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium">Exchange Connectivity</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Primary Exchange</label>
              {/* Menyambungkan pilihan dropdown ke state */}
              <select 
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                className="w-full p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-600"
              >
                <option value="okx">OKX</option>
                <option value="mexc">MEXC</option>
                <option value="bybit">Bybit</option>
                <option value="indodax">Indodax</option>
                <option value="binance">Binance</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Trading Environment</label>
              <select 
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-600"
              >
                <option value="spot">Spot Market</option>
                <option value="futures">Perpetual Futures</option>
              </select>
            </div>
          </div>
        </section>

        {/* API Management */}
        <section className="p-6 border border-zinc-800 bg-[#09090b] rounded-xl space-y-5">
          <div className="flex items-center gap-3 border-b border-zinc-800/50 pb-4">
            <Key className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-medium">API Keys & Security</h2>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">ORACLE AI Engine (OpenAI Key)</label>
              <input 
                type="password" 
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                placeholder="sk-..." 
                className="w-full p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-600 font-mono" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Exchange API Key (Optional for Read-Only)</label>
              <input 
                type="password" 
                value={exchangeKey}
                onChange={(e) => setExchangeKey(e.target.value)}
                placeholder="Enter API Key" 
                className="w-full p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-600 font-mono" 
              />
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <Shield className="w-5 h-5 text-zinc-400 flex-shrink-0" />
            <p className="text-xs text-zinc-400 leading-relaxed">
              API Keys are securely saved in your browser's local storage. They are never sent to external databases.
            </p>
          </div>
        </section>

        <div className="flex justify-end pt-4">
          <button 
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 font-semibold rounded-lg transition-colors ${
              isSaved 
                ? "bg-emerald-600 text-white" 
                : "bg-zinc-100 text-black hover:bg-white"
            }`}
          >
            {isSaved ? <><Check className="w-4 h-4" /> Configuration Saved!</> : <><Save className="w-4 h-4" /> Save Configuration</>}
          </button>
        </div>
      </div>
    </div>
  );
}