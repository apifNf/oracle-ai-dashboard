"use client";

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart, Search, TrendingUp, TrendingDown } from "lucide-react";
import { TradingViewChart } from "@/components/technical-analyst/tradingview-chart";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

// Urutan kanonik — sama dengan 30 aset SCANNER_PAIRS di backend. List tidak
// mengocok ulang saat harga live berubah.
const ASSET_ORDER = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT",
  "POL", "UNI", "LTC", "BCH", "ETC", "FIL", "ICP", "VET", "NEAR", "OP",
  "ARB", "INJ", "RENDER", "ATOM", "IMX", "STX", "TRX", "TAO", "S", "SUI",
];

type Row = { coin: string; price: number | null; change_24h: number | null };

const fmtPrice = (v: number | null): string => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export default function TechnicalAnalystPage() {
  const [live, setLive] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<string>("BTC");
  const [query, setQuery] = useState("");

  // Ambil harga + perubahan 24J dari snapshot Scanner yang sudah ada.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/scanner/signals`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, Row> = {};
        for (const s of data?.signals ?? []) {
          if (s?.coin) map[s.coin] = { coin: s.coin, price: s.price ?? null, change_24h: s.change_24h ?? null };
        }
        if (active) setLive(map);
      } catch {
        /* biarkan list statis */
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const rows: Row[] = useMemo(
    () =>
      ASSET_ORDER.map(
        (coin) => live[coin] ?? { coin, price: null, change_24h: null },
      ).filter((r) => r.coin.toLowerCase().includes(query.trim().toLowerCase())),
    [live, query],
  );

  const tvSymbol = `BINANCE:${selected}USDT`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400">
            Technical Analyst
          </p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            <CandlestickChart className="w-8 h-8 text-emerald-500" /> Interactive Charting
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-500">
            TradingView Advanced Chart · {ASSET_ORDER.length} aset Scanner · {tvSymbol}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ---------------- KIRI: Asset list (glassmorphism) ---------------- */}
        <aside className="lg:w-1/4 lg:min-w-[240px] rounded-2xl border border-white/10 bg-[#0e1015]/70 dark:bg-[#0e1015]/70 backdrop-blur-md shadow-xl overflow-hidden flex flex-col max-h-[45vh] lg:max-h-[calc(100vh-11rem)]">
          <div className="p-3 border-b border-white/10">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari aset…"
                className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {rows.length === 0 ? (
              <p className="p-4 text-xs text-zinc-500">Tidak ada aset cocok.</p>
            ) : (
              rows.map((r) => {
                const isActive = r.coin === selected;
                const up = (r.change_24h ?? 0) >= 0;
                return (
                  <button
                    key={r.coin}
                    onClick={() => setSelected(r.coin)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left border-l-2 transition-colors",
                      isActive
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-transparent hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn("text-sm font-bold", isActive ? "text-white" : "text-zinc-200")}>
                        {r.coin}
                        <span className="ml-1 text-[10px] font-medium text-zinc-600">/ USDT</span>
                      </p>
                      <p className="text-[11px] font-mono text-zinc-500">{fmtPrice(r.price)}</p>
                    </div>
                    {typeof r.change_24h === "number" ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums shrink-0",
                          up ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {up ? "+" : ""}
                        {r.change_24h.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-[11px] text-zinc-600 shrink-0">—</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ---------------- KANAN: TradingView chart ---------------- */}
        <section className="lg:flex-1 rounded-2xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl">
          <div className="h-[62vh] lg:h-[calc(100vh-11rem)] w-full">
            <TradingViewChart symbol={tvSymbol} interval="60" />
          </div>
        </section>
      </div>
    </div>
  );
}
