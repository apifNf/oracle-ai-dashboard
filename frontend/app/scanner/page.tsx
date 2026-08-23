"use client";

import { useEffect, useState, useRef } from "react";
import { TrendingDown, TrendingUp, Minus, Activity, Bug, Wifi, WifiOff, Loader2 } from "lucide-react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import { useTheme } from "next-themes";

type ChartData = { time: number; open: number; high: number; low: number; close: number };
type Signal = { 
  coin: string; 
  signal: string; 
  confidence: number; 
  rsi?: number; 
  ema20?: number; 
  ema50?: number; 
  trend: string; 
  chartData?: ChartData[]; 
};

// Komponen MiniChart dengan dukungan reaktif Light/Dark Mode
const MiniChart = ({ data, isDark }: { data: ChartData[]; isDark: boolean }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      height: 140,
      autoSize: true, 
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#71717a" : "#64748b",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(39, 39, 42, 0.4)" : "#e2e8f0" }, 
        horzLines: { color: isDark ? "rgba(39, 39, 42, 0.4)" : "#e2e8f0" },
      },
      timeScale: {
        timeVisible: true,
        borderColor: isDark ? "#27272a" : "#e2e8f0",
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: isDark ? "#27272a" : "#e2e8f0",
      },
      handleScroll: false, 
      handleScale: false,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    candlestickSeries.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data, isDark]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full mt-4 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 dark:border-zinc-800/50 dark:bg-[#00000020] transition-colors duration-500" 
    />
  );
};

export default function ScannerPage() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [testMode, setTestMode] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => setMounted(true), []);
  const isDark = mounted ? resolvedTheme === "dark" : true;

  useEffect(() => {
    if (testMode) {
      setWsStatus("disconnected");
      setLoading(true);
      const timer = setTimeout(() => {
        setSignals([
          { coin: "BTC", signal: "SHORT", confidence: 85, rsi: 78.4, ema20: 64150.25, ema50: 62000.80, trend: "Bearish" },
          { coin: "ETH", signal: "LONG", confidence: 72, rsi: 28.5, ema20: 3450.12, ema50: 3500.45, trend: "Bullish" },
          { coin: "SOL", signal: "LONG", confidence: 80, rsi: 56.95, ema20: 94.35, ema50: 93.26, trend: "Bullish" }
        ]);
        setLoading(false);
      }, 800);
      return () => clearTimeout(timer);
    }

    const HTTP_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
    const WS_URL = HTTP_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${WS_URL}/api/v1/ws/scanner`;

    setLoading(true);
    setWsStatus("connecting");
    const ws = new WebSocket(wsEndpoint);

    ws.onopen = () => {
      setWsStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error === "RATE_LIMIT" || (data.signals && data.signals.length === 0)) {
          console.warn("Menahan data terakhir di layar...");
        } else {
          setSignals(data.signals || []);
        }
      } catch (error) {
        console.error("Gagal membaca data WebSocket", error);
      } finally {
        setLoading(false);
      }
    };

    ws.onerror = () => {
      setWsStatus("disconnected");
      setLoading(false);
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      setLoading(false);
    };

    return () => ws.close();
  }, [testMode]);

  const formatNumber = (num?: number) => typeof num === "number" ? num.toFixed(2) : "N/A";

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">Scanner</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50 transition-colors">
            <Activity className="w-8 h-8 text-emerald-500" /> Live Signal Scanner
          </h1>
        </div>
        
        {/* BUTTON CONTROL SECTION */}
        <div className="flex gap-3">
          <button 
            onClick={() => setTestMode(!testMode)} 
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all duration-300 font-medium ${
              testMode 
                ? "bg-emerald-50 border-emerald-300 text-emerald-600 shadow-sm dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400 dark:shadow-none" 
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm dark:bg-[#09090b] dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:shadow-none"
            }`}
          >
            <Bug className="w-4 h-4" /> {testMode ? "Test Mode: ON" : "Test Mode: OFF"}
          </button>
          
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all duration-300 font-medium shadow-sm dark:shadow-none ${
            wsStatus === "connected" 
              ? "bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900 dark:text-emerald-500" 
              : "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900 dark:text-red-500"
          }`}>
            {wsStatus === "connected" ? <Wifi className="w-4 h-4 animate-pulse" /> : <WifiOff className="w-4 h-4" />}
            <span className="text-sm">{wsStatus === "connected" ? "Live Stream" : "Disconnected"}</span>
          </div>
        </div>
      </div>

      {/* STATE 1: LOADING STATE */}
      {loading && signals.length === 0 ? (
        <div className="space-y-6">
          {/* Status Banner */}
          <div className="p-8 border border-slate-200 bg-white/80 dark:border-zinc-800 dark:bg-[#09090b]/80 backdrop-blur-sm rounded-xl text-center flex flex-col items-center justify-center transition-all duration-500 shadow-sm dark:shadow-none">
            <div className="relative flex items-center justify-center mb-3">
              <span className="animate-ping absolute inline-flex h-9 w-9 rounded-full bg-emerald-400 dark:bg-emerald-500 opacity-25"></span>
              <div className="relative inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-zinc-100">
              Collecting Real-Time Market Data
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-1 max-w-md">
              Please wait while live market feeds, RSI (14), and EMA indicators are being synchronized.
            </p>
          </div>

          {/* Skeleton Shimmer Grid Cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div 
                key={i} 
                className="border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl p-5 animate-pulse space-y-4 shadow-sm dark:shadow-none"
              >
                <div className="flex justify-between items-center pb-2">
                  <div className="h-6 w-24 bg-slate-200 dark:bg-zinc-800 rounded"></div>
                  <div className="h-6 w-16 bg-slate-200 dark:bg-zinc-800 rounded"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-slate-100 dark:bg-zinc-800/60 rounded"></div>
                  <div className="h-4 w-full bg-slate-100 dark:bg-zinc-800/60 rounded"></div>
                  <div className="h-4 w-full bg-slate-100 dark:bg-zinc-800/60 rounded"></div>
                </div>
                <div className="h-[140px] w-full bg-slate-100 dark:bg-zinc-900 rounded-lg border border-slate-200/60 dark:border-zinc-800/40"></div>
              </div>
            ))}
          </div>
        </div>
      ) : signals.length === 0 && !loading ? (
        /* STATE 2: EMPTY STATE (Selesai scan tapi tidak ada sinyal ekstrem) */
        <div className="p-12 border border-dashed border-slate-300 bg-slate-50 dark:border-zinc-800 dark:bg-transparent rounded-xl text-slate-500 dark:text-zinc-500 text-center flex flex-col items-center transition-all duration-500">
          <Activity className="w-12 h-12 mb-4 opacity-30" />
          <p>Scanning market 24/7... Please wait while data is being collected.</p>
        </div>
      ) : (
        /* STATE 3: LOADED STATE (Menampilkan kartu-kartu sinyal pasar live) */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((item) => (
            <div 
              key={item.coin} 
              className="group relative border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl p-5 hover:border-slate-300 dark:hover:border-zinc-700 transition-all duration-300 shadow-sm hover:shadow-md dark:shadow-none"
            >
              {/* Card Header */}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors">
                  {item.coin} <span className="text-sm font-medium text-slate-400 dark:text-zinc-500">/ USDT</span>
                </h2>
                <span className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
                    item.signal === "LONG" 
                      ? "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-500 dark:border-emerald-500/20" 
                      : item.signal === "SHORT" 
                      ? "bg-red-100 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20" 
                      : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/20"
                  }`}
                >
                  {item.signal}
                </span>
              </div>
              
              {/* Card Data Rows */}
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm border-b border-slate-100 dark:border-zinc-800/50 pb-2 transition-colors">
                  <span className="text-slate-500 dark:text-zinc-400 font-medium">Confidence</span>
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">{item.confidence}%</span>
                </div>
                
                <div className="flex justify-between items-center text-sm border-b border-slate-100 dark:border-zinc-800/50 pb-2 transition-colors">
                  <span className="text-slate-500 dark:text-zinc-400 font-medium">RSI (14)</span>
                  <span className={`font-mono font-medium ${
                    item.rsi && item.rsi > 70 
                      ? "text-red-600 dark:text-red-400" 
                      : item.rsi && item.rsi < 30 
                      ? "text-emerald-600 dark:text-emerald-400" 
                      : "text-slate-700 dark:text-zinc-300"
                  }`}>
                    {formatNumber(item.rsi)}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm border-b border-slate-100 dark:border-zinc-800/50 pb-2 transition-colors">
                  <span className="text-slate-500 dark:text-zinc-400 font-medium">EMA 20 / 50</span>
                  <span className="font-mono text-slate-700 dark:text-zinc-300 font-medium">
                    {formatNumber(item.ema20)} <span className="text-slate-300 dark:text-zinc-600">/</span> {formatNumber(item.ema50)}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm pt-1">
                  <span className="text-slate-500 dark:text-zinc-400 font-medium">Market Trend</span>
                  <div className="flex items-center gap-1.5 font-medium">
                    {item.trend?.toLowerCase() === "bullish" ? (
                      <><TrendingUp className="w-4 h-4 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-500">Bullish</span></>
                    ) : item.trend?.toLowerCase() === "bearish" ? (
                      <><TrendingDown className="w-4 h-4 text-red-500" /><span className="text-red-600 dark:text-red-500">Bearish</span></>
                    ) : (
                      <><Minus className="w-4 h-4 text-slate-400 dark:text-zinc-500" /><span className="text-slate-500 dark:text-zinc-400">Neutral</span></>
                    )}
                  </div>
                </div>

                {/* KANVAS GRAFIK */}
                {item.chartData && item.chartData.length > 0 && (
                  <MiniChart data={item.chartData} isDark={isDark} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}