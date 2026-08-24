"use client";

import { useState, useEffect } from "react";
import { Globe, TrendingUp, TrendingDown, AlertCircle, BarChart3, Activity, ArrowRightLeft, ExternalLink, Loader2 } from "lucide-react";

type NewsItem = { id: string; source: string; title: string; time: string; impact: string; url: string; image: string; };
type OnChainItem = { label: string; value: string; status: string; desc: string; };

export default function MarketIntelligencePage() {
  const [mounted, setMounted] = useState(false);
  
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [isLoadingNews, setIsLoadingNews] = useState(true);
  
  const [onChainData, setOnChainData] = useState<OnChainItem[]>([]);
  const [isLoadingOnChain, setIsLoadingOnChain] = useState(true);

  useEffect(() => {
    setMounted(true);
    fetchNews();
    fetchOnChain();
  }, []);

  const fetchNews = async () => {
    try {
      setIsLoadingNews(true);
      const res = await fetch('/api/news');
      if (res.ok) {
        const data = await res.json();
        setNewsData(data);
      }
    } catch (error) {
      console.error("Gagal mengambil live news:", error);
    } finally {
      setIsLoadingNews(false);
    }
  };

  const fetchOnChain = async () => {
    try {
      setIsLoadingOnChain(true);
      const res = await fetch('/api/onchain');
      if (res.ok) {
        const data = await res.json();
        setOnChainData(data);
      }
    } catch (error) {
      console.error("Gagal mengambil data on-chain:", error);
    } finally {
      setIsLoadingOnChain(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">Market Intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50 transition-colors">
            <Globe className="w-8 h-8 text-emerald-500" /> Macro & On-Chain
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        
        {/* KOLOM KIRI: ALPHA NEWS FEED */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3 transition-colors">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 transition-colors">
              <Globe className="w-5 h-5 text-slate-400 dark:text-zinc-500" /> Alpha News Feed
            </h2>
            <span className="text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors shadow-sm dark:shadow-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live
            </span>
          </div>

          <div className="space-y-4 relative min-h-[400px] max-h-[750px] overflow-y-auto pr-2 pb-4">
            {isLoadingNews ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
                <p className="text-sm font-medium animate-pulse">Fetching Institutional Intel...</p>
              </div>
            ) : (
              newsData.map((news) => (
                <a 
                  key={news.id} 
                  href={news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col sm:flex-row gap-4 p-4 bg-white border border-slate-200 hover:border-emerald-500/50 dark:bg-[#09090b] dark:border-zinc-800 dark:hover:border-emerald-500/50 rounded-xl shadow-sm dark:shadow-none transition-all duration-300 group"
                >
                  {news.image && (
                    <div className="sm:w-28 sm:h-24 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-zinc-800/50 relative">
                      <img src={news.image} alt={news.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <span className="text-xs font-bold text-slate-400 dark:text-zinc-500 tracking-wide uppercase transition-colors">{news.source}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors flex items-center shrink-0 gap-1 ${
                        news.impact === "BULLISH" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500" :
                        news.impact === "BEARISH" ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500" :
                        "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500"
                      }`}>
                        {news.impact === "BULLISH" && <TrendingUp className="w-3 h-3" />}
                        {news.impact === "BEARISH" && <TrendingDown className="w-3 h-3" />}
                        {news.impact === "IMPORTANT" && <AlertCircle className="w-3 h-3" />}
                        {news.impact}
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-medium text-slate-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-start justify-between gap-4">
                      <span className="line-clamp-2">{news.title}</span>
                      <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-500 mt-2 transition-colors">{news.time}</p>
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        {/* KOLOM KANAN: ON-CHAIN RADAR */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3 transition-colors">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 transition-colors">
              <Activity className="w-5 h-5 text-slate-400 dark:text-zinc-500" /> On-Chain Radar
            </h2>
            <span className="text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors shadow-sm dark:shadow-none">
              Live Data
            </span>
          </div>

          <div className="grid gap-4 relative min-h-[300px]">
            {isLoadingOnChain ? (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
                <p className="text-sm font-medium animate-pulse">Syncing Whale Movements...</p>
              </div>
            ) : (
              onChainData.map((metric, idx) => (
                <div key={idx} className="p-5 bg-white border border-slate-200 dark:bg-[#09090b] dark:border-zinc-800 rounded-xl shadow-sm dark:shadow-none hover:border-slate-300 dark:hover:border-zinc-700 transition-colors duration-300">
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors">{metric.label}</p>
                    <BarChart3 className="w-4 h-4 text-slate-400 dark:text-zinc-600 transition-colors" />
                  </div>
                  <h4 className="text-xl font-bold text-slate-900 dark:text-white transition-colors">{metric.value}</h4>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800/50 transition-colors">
                    <span className={`w-2 h-2 rounded-full ${
                      metric.status === "BULLISH" ? "bg-emerald-500" :
                      metric.status === "BEARISH" ? "bg-red-500" :
                      metric.status === "IMPORTANT" ? "bg-amber-500" : "bg-slate-400 dark:bg-zinc-500"
                    }`}></span>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 transition-colors">{metric.desc}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 dark:bg-zinc-900/50 dark:border-zinc-800 rounded-xl mt-6 transition-colors">
            <div className="flex gap-3">
              <ArrowRightLeft className="w-5 h-5 text-slate-400 dark:text-zinc-500 shrink-0" />
              <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors">
                On-Chain data provides visibility into institutional movements before they impact price action. Powered by CryptoQuant Data.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}