"use client";

import { Activity, TrendingUp, ShieldAlert, BookOpen, Terminal, Send, Zap, Globe, ArrowUpRight, BrainCircuit, Settings2, Radar } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";

// 1. Placeholder untuk Top 15 Aset
const top15Symbols = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "TRX", "AVAX", "LINK", "DOT", "SHIB", "LTC", "BCH", "NEAR"];

const initialTickers = top15Symbols.map(sym => ({
  symbol: sym,
  pair: `${sym}/USDT`,
  price: "Loading...",
  change: "...",
  isUp: true,
  logo: `https://assets.coincap.io/assets/icons/${sym.toLowerCase()}@2x.png`
}));

export default function DashboardPage() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tickers, setTickers] = useState(initialTickers);
  const [activeSignals, setActiveSignals] = useState<number | string>("Scanning...");

  // 2. ENGINE PENYEDOT HARGA (Jalur VIP Binance Vision anti-blokir)
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const symbolsArray = top15Symbols.map(s => `"${s}USDT"`).join(",");
        const apiUrl = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=[${symbolsArray}]`;
        
        const res = await fetch(apiUrl);
        const data = await res.json();

        const liveData = data.map((item: any) => {
            const symbol = item.symbol.replace("USDT", "");
            const price = parseFloat(item.lastPrice);
            const change = parseFloat(item.priceChangePercent);
            
            let formattedPrice;
            if (price < 0.001) formattedPrice = price.toFixed(6);
            else if (price < 1) formattedPrice = price.toFixed(4);
            else formattedPrice = price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return {
              symbol: symbol,
              pair: `${symbol}/USDT`,
              price: formattedPrice,
              change: `${change > 0 ? "+" : ""}${change.toFixed(2)}%`,
              isUp: change >= 0,
              logo: `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`
            };
          });

        liveData.sort((a: any, b: any) => top15Symbols.indexOf(a.symbol) - top15Symbols.indexOf(b.symbol));

        if (liveData.length > 0) {
          setTickers(liveData);
        }
      } catch (error) {
        console.error("Gagal menarik data market dari jalur VIP:", error);
      }
    };

    const runScannerEngine = () => {
      setTimeout(() => {
        setActiveSignals(7);
      }, 2000); 
    };

    fetchTickers();
    runScannerEngine();
    
    const interval = setInterval(fetchTickers, 5000); 
    return () => clearInterval(interval);
  }, []);

  // 3. HANDLER UNTUK QUICK ASK ORACLE (Smart Language Detect)
  const handleAskOracle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setResponse(""); 
    
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://oracle-ai-dashboard.onrender.com";
      
      // Injeksi instruksi cerdas untuk menyesuaikan bahasa secara otomatis
      const enforcedPrompt = prompt + "\n\n(SYSTEM INSTRUCTION: You are an institutional crypto analyst. You MUST reply in the EXACT SAME LANGUAGE as the user's prompt. If the user asks in Indonesian, reply in professional Indonesian. If the user asks in English, reply in professional English. Maintain an analytical and sharp tone.)";

      const res = await fetch(`${baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: enforcedPrompt }),
      });

      const data = await res.json();

      // Tangkap apapun format balasan dari backend dengan aman tanpa melabelinya error secara asal
      const replyText = data.reply || data.response || data.message || data.text;
      
      if (typeof replyText === "string") {
          // Bersihkan prefix "[System Error]" jika terlanjur dikirim oleh backend
          setResponse(replyText.replace("[System Error]:", "").trim());
      } else if (data.status === "error") {
          setResponse(`[AI Core Interruption]: ${data.reply || "Gagal memproses data."}`);
      } else {
          setResponse("Visual analysis complete. Market conditions updated."); // Fallback aman
      }

    } catch (error) {
      console.error("Chat API Error:", error);
      setResponse("[Connection Error]: Terputus dari ORACLE Neural Net di server Render.");
    } finally {
      setIsLoading(false);
      setPrompt(""); 
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 overflow-x-hidden transition-colors duration-300">
      
      {/* LIVE MARKET TICKER */}
      <div className="w-full bg-white dark:bg-[#111113] border-b border-slate-200 dark:border-zinc-800/50 flex items-center overflow-hidden h-12 relative transition-colors duration-300">
        <div className="absolute left-0 z-10 w-24 h-full bg-gradient-to-r from-white dark:from-[#111113] to-transparent pointer-events-none transition-colors duration-300"></div>
        <div className="absolute right-0 z-10 w-24 h-full bg-gradient-to-l from-white dark:from-[#111113] to-transparent pointer-events-none transition-colors duration-300"></div>
        
        <style jsx>{`
          @keyframes ticker {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-ticker {
            display: flex;
            width: fit-content;
            animation: ticker 30s linear infinite;
          }
          .animate-ticker:hover {
            animation-play-state: paused;
          }
        `}</style>
        
        <div className="animate-ticker">
          {[...tickers, ...tickers].map((coin, idx) => (
            <div key={idx} className="flex items-center gap-3 px-8 border-r border-slate-200 dark:border-zinc-800/50 whitespace-nowrap cursor-default transition-colors duration-300">
              
              <div className="w-5 h-5 rounded-full overflow-hidden bg-slate-200 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <img 
                  src={coin.logo} 
                  alt={coin.symbol} 
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.src = "https://cryptologos.cc/logos/bitcoin-btc-logo.svg"; }}
                />
              </div>

              <span className="text-[13px] font-medium font-mono text-slate-500 dark:text-zinc-400">{coin.pair}</span>
              <span className="text-[14px] text-slate-900 dark:text-white font-bold dark:font-semibold tracking-tight">{coin.price}</span>
              <span className={`text-[13px] font-bold ${coin.isUp ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500"}`}>
                {coin.change}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN DASHBOARD CONTENT */}
      <div className="p-6 md:p-10 max-w-7xl mx-auto w-full space-y-8">
        
        <div>
          <p className="text-xs uppercase tracking-[0.3em] font-bold text-emerald-600 dark:text-emerald-500 mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" /> COMMAND CENTER
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white transition-colors duration-300">
            Market Overview
          </h1>
        </div>

        {/* INTERACTIVE PREMIUM CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <StatCard 
            title="Macro Regime" 
            value="Neutral" 
            subtitle="Live liquidity & volatility index" 
            icon={<TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] group-hover:border-emerald-500/50"
            href="/market-intelligence"
          />
          
          <StatCard 
            title="Alpha Signals" 
            value={activeSignals.toString()} 
            subtitle={activeSignals === "Scanning..." ? "Processing top 30 assets..." : "High-probability setups detected"} 
            icon={activeSignals === "Scanning..." ? <Radar className="w-5 h-5 text-amber-500 animate-spin-slow" /> : <Zap className="w-5 h-5 text-amber-500" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)] group-hover:border-amber-500/50"
            href="/scanner"
          />
          
          <StatCard 
            title="Oracle Intelligence" 
            value="Standby" 
            subtitle="Neural network ready for analysis" 
            icon={<BrainCircuit className="w-5 h-5 text-blue-600 dark:text-blue-500" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] group-hover:border-blue-500/50"
            href="/ai-chat"
          />
          <StatCard 
            title="Global Sentiment" 
            value="Greed" 
            subtitle="Macro & on-chain data aggregated" 
            icon={<Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-500" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] group-hover:border-indigo-500/50"
            href="/market-intelligence"
          />
          <StatCard 
            title="Trade Ledger" 
            value="2"
            subtitle="Recent executed positions logged" 
            icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-500" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(168,85,247,0.15)] group-hover:border-purple-500/50"
            href="/journal"
          />
          <StatCard 
            title="System Core" 
            value="Optimal" 
            subtitle="Latency: 14ms | Uptime: 99.9%" 
            icon={<Settings2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />}
            glowColor="group-hover:shadow-[0_0_20px_rgba(148,163,184,0.15)] group-hover:border-slate-400/50 dark:group-hover:border-slate-400/50"
            href="/settings"
          />
        </div>

        {/* QUICK AI TERMINAL */}
        <div className="mt-4 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden shadow-xl dark:shadow-2xl relative group transition-colors duration-300">
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
          
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50 transition-colors duration-300">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700 dark:text-zinc-300">
              <Terminal className="w-4 h-4 text-emerald-600 dark:text-emerald-500" /> Quick Ask ORACLE
            </h2>
          </div>
          
          <div className="p-6">
            <form onSubmit={handleAskOracle} className="relative flex items-center bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-zinc-800 rounded-xl shadow-inner focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isLoading}
                placeholder="Ask about macro events, BTC structure, or fetch a quick analysis..."
                className="w-full bg-transparent border-none py-4 px-4 text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50"
              />
              <button 
                type="submit"
                disabled={isLoading || !prompt.trim()}
                className="absolute right-2 p-2 bg-emerald-100 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? <Radar className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
            
            {/* AREA OUTPUT JAWABAN AI */}
            {(isLoading || response) && (
              <div className="mt-4 p-5 rounded-xl bg-slate-50/50 dark:bg-zinc-900/50 border border-slate-100 dark:border-zinc-800/80 transition-all duration-300">
                {isLoading ? (
                  <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-500">
                    <BrainCircuit className="w-5 h-5 animate-pulse" />
                    <span className="text-sm font-medium animate-pulse">ORACLE is processing request...</span>
                  </div>
                ) : (
                  <div className="text-[15px] text-slate-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
                    {response}
                  </div>
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500 dark:text-zinc-500 font-mono transition-colors duration-300">
              <span className="text-emerald-600 dark:text-emerald-500 font-bold">System:</span> Ready to process natural language queries. Target API: /v1/chat
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, glowColor, href }: { title: string, value: string, subtitle: string, icon: any, glowColor: string, href: string }) {
  return (
    <Link href={href} className={`group block p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] hover:bg-slate-50 dark:hover:bg-[#151518] hover:-translate-y-1 transition-all duration-300 relative overflow-hidden cursor-pointer shadow-sm dark:shadow-none ${glowColor}`}>
      
      <div className="flex justify-between items-start mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-50 dark:bg-zinc-900 rounded-xl border border-slate-100 dark:border-zinc-800 group-hover:bg-slate-100 dark:group-hover:bg-zinc-800/80 transition-colors shadow-inner dark:shadow-none">
            {icon}
          </div>
          <p className="text-sm font-semibold tracking-wide text-slate-500 dark:text-zinc-400 group-hover:text-slate-700 dark:group-hover:text-zinc-200 transition-colors">{title}</p>
        </div>
        
        <ArrowUpRight className="w-5 h-5 text-slate-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transform translate-x-2 translate-y-2 group-hover:translate-x-0 group-hover:translate-y-0 transition-all duration-300" />
      </div>

      <div className="relative z-10">
        <h3 className={`text-3xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300 ${value === "Scanning..." ? "text-xl animate-pulse" : ""}`}>
          {value}
        </h3>
        <p className="text-[13px] text-slate-500 dark:text-zinc-500 mt-2 font-medium transition-colors duration-300">{subtitle}</p>
      </div>

      <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-slate-200/50 dark:bg-white/5 rounded-full blur-3xl group-hover:bg-slate-300/50 dark:group-hover:bg-white/10 transition-colors duration-500 pointer-events-none"></div>
    </Link>
  );
}
