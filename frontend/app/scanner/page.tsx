"use client";

import { useEffect, useState, useRef } from "react";
import { TrendingDown, TrendingUp, Minus, Activity, Bug, Wifi, WifiOff } from "lucide-react";

// PERBAIKAN 1: Menambahkan 'CandlestickSeries' pada import dari TradingView Versi 5
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";

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

const MiniChart = ({ data }: { data: ChartData[] }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      height: 140,
      autoSize: true, 
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: 'rgba(39, 39, 42, 0.4)' }, 
        horzLines: { color: 'rgba(39, 39, 42, 0.4)' },
      },
      timeScale: {
        timeVisible: true,
        borderColor: '#27272a',
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: '#27272a',
      },
      handleScroll: false, 
      handleScale: false,
    });

    // PERBAIKAN 2: Menggunakan format penulisan TradingView Versi 5
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    candlestickSeries.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data]);

  return <div ref={chartContainerRef} className="w-full mt-4 rounded-lg overflow-hidden border border-zinc-800/50 bg-[#00000020]" />;
};

export default function ScannerPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [testMode, setTestMode] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    if (testMode) {
      setWsStatus("disconnected");
      setLoading(true);
      const timer = setTimeout(() => {
        setSignals([
          { coin: "BTC", signal: "SHORT", confidence: 85, rsi: 78.4, ema20: 64150.25, ema50: 62000.80, trend: "Bearish" },
          { coin: "ETH", signal: "LONG", confidence: 72, rsi: 28.5, ema20: 3450.12, ema50: 3500.45, trend: "Bullish" }
        ]);
        setLoading(false);
      }, 800);
      return () => clearTimeout(timer);
    }

    const HTTP_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
    const WS_URL = HTTP_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${WS_URL}/api/v1/ws/scanner`;

    setWsStatus("connecting");
    const ws = new WebSocket(wsEndpoint);

    ws.onopen = () => {
      setWsStatus("connected");
      setLoading(false);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error === "RATE_LIMIT" || (data.signals && data.signals.length === 0)) {
          console.warn("Menahan data terakhir di layar...");
        } else {
          setSignals(data.signals);
        }
      } catch (error) {
        console.error("Gagal membaca data WebSocket", error);
      }
    };

    ws.onerror = () => setWsStatus("disconnected");
    ws.onclose = () => setWsStatus("disconnected");

    return () => ws.close();
  }, [testMode]);

  const formatNumber = (num?: number) => typeof num === "number" ? num.toFixed(2) : "N/A";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-zinc-400">Scanner</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3">
            <Activity className="w-8 h-8 text-emerald-500" /> Live Signal Scanner
          </h1>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setTestMode(!testMode)} 
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${testMode ? "bg-emerald-900/30 border-emerald-500 text-emerald-400" : "bg-[#09090b] border-zinc-800"}`}
          >
            <Bug className="w-4 h-4" /> {testMode ? "Test Mode: ON" : "Test Mode: OFF"}
          </button>
          
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${wsStatus === 'connected' ? 'bg-emerald-950/20 border-emerald-900 text-emerald-500' : 'bg-red-950/20 border-red-900 text-red-500'}`}>
            {wsStatus === "connected" ? <Wifi className="w-4 h-4 animate-pulse" /> : <WifiOff className="w-4 h-4" />}
            <span className="text-sm font-medium">{wsStatus === "connected" ? "Live Stream" : "Disconnected"}</span>
          </div>
        </div>
      </div>

      {signals.length === 0 && !loading ? (
        <div className="p-12 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-center flex flex-col items-center transition-all">
          <Activity className="w-12 h-12 mb-4 opacity-20" />
          <p>Scanning market 24/7... No extreme technical signals detected right now.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((item) => (
            <div key={item.coin} className="group relative border border-zinc-800 rounded-xl p-5 bg-[#09090b] hover:border-zinc-700 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold tracking-tight">{item.coin} <span className="text-sm font-medium text-zinc-500">/ USDT</span></h2>
                <span className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                    item.signal === "LONG" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : item.signal === "SHORT" ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                  }`}>
                  {item.signal}
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm border-b border-zinc-800/50 pb-2">
                  <span className="text-zinc-400">Confidence</span>
                  <span className="font-semibold text-zinc-100">{item.confidence}%</span>
                </div>
                
                <div className="flex justify-between items-center text-sm border-b border-zinc-800/50 pb-2">
                  <span className="text-zinc-400">RSI (14)</span>
                  <span className={`font-mono ${item.rsi && item.rsi > 70 ? "text-red-400" : item.rsi && item.rsi < 30 ? "text-emerald-400" : "text-zinc-300"}`}>
                    {formatNumber(item.rsi)}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm border-b border-zinc-800/50 pb-2">
                  <span className="text-zinc-400">EMA 20 / 50</span>
                  <span className="font-mono text-zinc-300">
                    {formatNumber(item.ema20)} <span className="text-zinc-600">/</span> {formatNumber(item.ema50)}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm pt-1">
                  <span className="text-zinc-400">Market Trend</span>
                  <div className="flex items-center gap-1.5 font-medium">
                    {item.trend?.toLowerCase() === "bullish" ? (
                      <><TrendingUp className="w-4 h-4 text-emerald-500" /><span className="text-emerald-500">Bullish</span></>
                    ) : item.trend?.toLowerCase() === "bearish" ? (
                      <><TrendingDown className="w-4 h-4 text-red-500" /><span className="text-red-500">Bearish</span></>
                    ) : (
                      <><Minus className="w-4 h-4 text-zinc-500" /><span className="text-zinc-400">Neutral</span></>
                    )}
                  </div>
                </div>

                {/* KANVAS GRAFIK DIMUAT DI SINI */}
                {item.chartData && item.chartData.length > 0 && (
                  <MiniChart data={item.chartData} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}