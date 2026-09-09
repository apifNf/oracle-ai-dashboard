"use client";

// Chart candle per-aset — ON-DEMAND.
//
// Diekstrak dari app/scanner/page.tsx supaya modal eksekusi bisa memakai chart
// yang sama tanpa menduplikasi logika fetch + daur hidup lightweight-charts.
// Satu-satunya perbedaan pemakaian adalah `height`.
//
// Data diambil per (coin, interval) saat komponen mount — inilah yang dulu
// menggantikan pengiriman 4 timeframe x 30 aset di setiap broadcast scanner.
// Instance chart selalu di-dispose di cleanup supaya tidak menahan canvas.

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type DetailPayload = {
  symbol: string;
  status: string;
  interval: string;
  source: string | null;
  price: number | null;
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  trend: string | null;
  candles_used: number;
  last_closed_at: string | null;
  chartData: Candle[];
  live_price?: number | null;
  error: { code: string; message: string } | null;
};

const HTTP_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const DETAIL_ENDPOINT = `${HTTP_BASE}/api/v1/scanner/detail`;

export const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

type Props = {
  coin: string;
  isDark: boolean;
  /** Tinggi kanvas. Kartu scanner 220; modal eksekusi jauh lebih lega. */
  height?: number;
  /** Sembunyikan garis pemisah atas (dipakai saat sudah di dalam panel). */
  bare?: boolean;
  className?: string;
};

export function DetailChart({
  coin,
  isDark,
  height = 220,
  bare = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  const [interval, setIntervalValue] = useState<string>("1h");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#71717a" : "#64748b",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(39,39,42,0.4)" : "#e2e8f0" },
        horzLines: { color: isDark ? "rgba(39,39,42,0.4)" : "#e2e8f0" },
      },
      timeScale: { timeVisible: true, borderColor: isDark ? "#27272a" : "#e2e8f0" },
      rightPriceScale: { borderColor: isDark ? "#27272a" : "#e2e8f0" },
      handleScroll: false,
      handleScale: false,
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isDark, height]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${DETAIL_ENDPOINT}/${coin}?interval=${interval}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: DetailPayload = await res.json();
        if (!active) return;
        if (!body || !Array.isArray(body.chartData)) {
          throw new Error("Bentuk respons tidak dikenali");
        }
        setDetail(body);
      } catch (err) {
        if (controller.signal.aborted || !active) return;
        console.error(`[chart] detail ${coin} gagal:`, err);
        setError(err instanceof Error ? err.message : "Gagal memuat detail");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [coin, interval]);

  useEffect(() => {
    if (!seriesRef.current || !detail) return;
    if (detail.status !== "ok" || detail.chartData.length === 0) {
      seriesRef.current.setData([]);
      return;
    }
    seriesRef.current.setData(detail.chartData);
    chartRef.current?.timeScale().fitContent();
  }, [detail]);

  const unusable = Boolean(detail && detail.status !== "ok");

  return (
    <div
      className={cn(
        "space-y-2",
        !bare && "mt-4 border-t border-slate-100 dark:border-zinc-800/50 pt-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
          Price Action
          {detail?.source && (
            <span className="ml-1.5 normal-case tracking-normal text-slate-400 dark:text-zinc-600">
              · {detail.source}
            </span>
          )}
        </span>
        <div className="flex gap-1 p-0.5 bg-slate-100 dark:bg-zinc-900 rounded-md border border-slate-200 dark:border-zinc-800/80">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              onClick={(e) => {
                e.stopPropagation();
                setIntervalValue(tf);
              }}
              className={cn(
                "px-2 py-0.5 text-[10px] font-bold rounded-sm transition-all uppercase",
                interval === tf
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300",
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 dark:border-zinc-800/50 dark:bg-[#00000020]"
        />

        {(loading || error || unusable) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/85 dark:bg-black/70 backdrop-blur-[2px] text-center px-4">
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span className="text-xs text-slate-500 dark:text-zinc-400">Memuat candle…</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Candle tidak bisa ditampilkan
                </span>
                <span className="text-[11px] text-slate-500 dark:text-zinc-500 max-w-[240px]">
                  {error ?? detail?.error?.message ?? "Data tidak memadai."}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {detail?.status === "ok" && detail.last_closed_at && (
        <p className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono">
          Candle terakhir ditutup {new Date(detail.last_closed_at).toLocaleString("id-ID")} ·{" "}
          {detail.candles_used} candle dipakai
        </p>
      )}
    </div>
  );
}
