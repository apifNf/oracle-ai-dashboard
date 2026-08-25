"use client";

import { useState, useEffect } from "react";
import { Globe, TrendingUp, TrendingDown, AlertCircle, Activity, ExternalLink, Loader2, Clock, Box, Zap, ArrowRight, Wallet } from "lucide-react";

type NewsItem = { id: string; source: string; title: string; time: string; impact: string; url: string; image: string; };
type OnChainItem = { id: string; type: string; asset: string; amount: string; time: string; label: string; status: string; desc: string; from?: string; to?: string; };

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
    
    // DIPERLAMBAT: Auto-refresh data on-chain diubah dari 15 detik menjadi 30 detik
    const interval = setInterval(fetchOnChain, 50000);
    return () => clearInterval(interval);
  }, []);

  const fetchNews = async () => { try { setIsLoadingNews(true); const res = await fetch('/api/news'); if (res.ok) setNewsData(await res.json()); } catch (e) {} finally { setIsLoadingNews(false); } };
  const fetchOnChain = async () => { try { setIsLoadingOnChain(true); const res = await fetch('/api/onchain'); if (res.ok) setOnChainData(await res.json()); } catch (e) {} finally { setIsLoadingOnChain(false); } };

  if (!mounted) return null;

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400">Market Intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            <Globe className="w-8 h-8 text-emerald-600 dark:text-emerald-500" /> Macro & On-Chain
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        
        {/* KOLOM KIRI: ALPHA NEWS FEED */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-slate-500 dark:text-zinc-500" /> Alpha News Feed
            </h2>
            <span className="text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live
            </span>
          </div>

          <div className="space-y-4 relative min-h-[400px] max-h-[750px] overflow-y-auto pr-2 pb-4 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {isLoadingNews ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
                <p className="text-sm font-medium animate-pulse">Fetching Institutional Intel...</p>
              </div>
            ) : (
              newsData.map((news) => (
                <a key={news.id} href={news.url} target="_blank" rel="noopener noreferrer" 
                   // UI UPDATE: Ketebalan shadow & bg diperhalus (subtle look)
                   className="relative flex flex-col sm:flex-row gap-4 p-4 bg-white border border-slate-200 dark:bg-[#09090b]/80 dark:border-zinc-800/80 rounded-xl transition-all duration-500 group hover:border-emerald-500/30 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/5 hover:shadow-[0_8px_30px_rgba(16,185,129,0.06)] dark:hover:shadow-[0_0_15px_rgba(16,185,129,0.05)] overflow-hidden">
                  
                  {/* Efek Ambient Glow Halus - Opacity dikurangi drastis menjadi 3% & 5% */}
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/3 dark:to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/70 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                  {news.image && (
                    <div className="sm:w-28 sm:h-24 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-zinc-800/50 relative border border-transparent group-hover:border-emerald-500/10 transition-colors duration-500">
                      {/* Lapisan filter kaca hijau tipis - dikurangi dari 10% ke 5% */}
                      <div className="absolute inset-0 bg-emerald-500/5 mix-blend-overlay opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10"></div>
                      <img src={news.image} alt={news.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 relative z-10">
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <span className="text-xs font-bold text-slate-500 dark:text-zinc-500 tracking-wide uppercase group-hover:text-emerald-600 dark:group-hover:text-emerald-500/80 transition-colors duration-500">{news.source}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded flex items-center shrink-0 gap-1 transition-colors duration-500 ${news.impact === "BULLISH" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500 group-hover:bg-emerald-100/50 dark:group-hover:bg-emerald-500/10" : news.impact === "BEARISH" ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500 group-hover:bg-red-100/50 dark:group-hover:bg-red-500/10" : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500 group-hover:bg-amber-100/50 dark:group-hover:bg-amber-500/10"}`}>
                        {news.impact === "BULLISH" && <TrendingUp className="w-3 h-3" />}
                        {news.impact === "BEARISH" && <TrendingDown className="w-3 h-3" />}
                        {news.impact === "IMPORTANT" && <AlertCircle className="w-3 h-3" />}
                        {news.impact}
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-medium text-slate-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-700 dark:group-hover:text-emerald-400 flex items-start justify-between gap-4 transition-colors duration-500">
                      <span className="line-clamp-2">{news.title}</span>
                      <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500 shrink-0 mt-1 text-emerald-500/70" />
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-500 mt-2 transition-colors duration-500 group-hover:text-slate-600 dark:group-hover:text-zinc-400">{news.time}</p>
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        {/* KOLOM KANAN: LIVE ON-CHAIN STREAM */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> On-Chain Stream
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-500 border dark:border-emerald-500/20 px-2 py-1 rounded flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> Live Data
            </span>
          </div>

          <div className="space-y-3 relative min-h-[450px]">
            {isLoadingOnChain ? (
               <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl overflow-hidden bg-slate-50/80 dark:bg-[#09090b]/60 border border-slate-200 dark:border-zinc-800/80 backdrop-blur-sm">
                 <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.06)_1px,transparent_1px)] bg-[size:15px_15px]"></div>
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08)_0%,transparent_60%)] animate-pulse"></div>
                 <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-emerald-500/40 shadow-[0_0_15px_#10b981] animate-ping opacity-50"></div>
                 <div className="relative z-10 flex flex-col items-center justify-center p-8 bg-white/95 dark:bg-black/60 backdrop-blur-md rounded-2xl border border-emerald-500/40 shadow-[0_10px_40px_rgba(16,185,129,0.15)] dark:shadow-[0_0_30px_rgba(16,185,129,0.15)] w-3/4 max-w-sm">
                   <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-emerald-500/80 rounded-tl-md"></div>
                   <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-emerald-500/80 rounded-tr-md"></div>
                   <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-emerald-500/80 rounded-bl-md"></div>
                   <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-emerald-500/80 rounded-br-md"></div>
                   <div className="relative w-16 h-16 flex items-center justify-center mb-5">
                     <div className="absolute inset-0 rounded-full border-[2px] border-emerald-500/20 border-t-emerald-500 border-r-emerald-500 animate-spin"></div>
                     <div className="absolute inset-2 rounded-full border-[2px] border-emerald-500/30 border-b-emerald-400 animate-pulse"></div>
                     <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-bounce relative z-10" />
                   </div>
                   <span className="text-emerald-700 dark:text-emerald-500 font-mono text-[11px] font-bold tracking-[0.4em] uppercase text-center mb-3">
                     Decrypting Nodes
                   </span>
                   <div className="flex gap-2 items-center opacity-80">
                     <div className="w-2 h-1 bg-emerald-500 animate-pulse" style={{ animationDelay: '0ms' }}></div>
                     <div className="w-2 h-1 bg-emerald-500 animate-pulse" style={{ animationDelay: '150ms' }}></div>
                     <div className="w-2 h-1 bg-emerald-500 animate-pulse" style={{ animationDelay: '300ms' }}></div>
                     <div className="w-2 h-1 bg-emerald-500 animate-pulse" style={{ animationDelay: '450ms' }}></div>
                   </div>
                 </div>
               </div>
            ) : (
              onChainData.map((metric, idx) => (
                <div key={metric.id || idx} className="relative p-4 bg-white border border-slate-200 dark:bg-[#09090b]/80 dark:border-zinc-800/80 rounded-xl hover:border-emerald-500/30 hover:shadow-[0_4px_20px_rgba(16,185,129,0.1)] dark:hover:shadow-[0_0_15px_rgba(16,185,129,0.05)] transition-all duration-300 group cursor-default">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      {metric.type === "BLOCK" ? <Box className="w-4 h-4 text-slate-500 dark:text-zinc-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-500 transition-colors" /> : <Zap className={`w-4 h-4 ${metric.status === "IMPORTANT" ? "text-amber-500" : "text-emerald-600 dark:text-emerald-500/80 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors"}`} />}
                      <span className={`text-xs font-semibold uppercase tracking-wider ${metric.status === "IMPORTANT" ? "text-amber-600 dark:text-amber-500" : "text-slate-600 dark:text-zinc-400 group-hover:text-emerald-700 dark:group-hover:text-emerald-500 transition-colors"}`}>
                        {metric.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-md">
                      <Clock className="w-3 h-3 text-slate-400 dark:text-zinc-500" />
                      <span className="text-[10px] font-mono text-slate-700 dark:text-zinc-300">{metric.time}</span>
                    </div>
                  </div>
                  <div className="flex items-end gap-2 mb-2">
                    <h4 className={`text-2xl font-bold tracking-tight ${metric.type === "BLOCK" ? "text-slate-800 dark:text-white" : "text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600 dark:from-emerald-400 dark:to-cyan-400"}`}>
                      {metric.amount}
                    </h4>
                    <span className="text-sm font-bold text-slate-500 dark:text-zinc-400 mb-1">{metric.asset}</span>
                  </div>
                  {metric.type === "TX" && (
                    <div className="flex items-center justify-between mt-3 mb-2 text-[10px] font-mono w-full bg-slate-50 dark:bg-zinc-900/50 p-2 rounded-lg border border-slate-200 dark:border-zinc-800/50 group-hover:border-emerald-500/20 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        <span className="text-slate-600 dark:text-zinc-400">{metric.from}</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">{metric.to}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800/50">
                    <p className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 truncate mr-2">{metric.desc}</p>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      metric.status === "IMPORTANT" ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse" :
                      metric.status === "BULLISH" ? "bg-emerald-500" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"
                    }`}></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}