"use client";

// Panel Order Book Level 2 — dipakai di modal eksekusi.
//
// Aliran datanya dikendalikan penuh oleh prop `enabled`: komponen ini tidak
// pernah memanggil apa pun saat modal tertutup (lihat hooks/use-order-book).

import { AlertTriangle, Loader2, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrderBook } from "@/hooks/use-order-book";
import type { OrderBookLevel, OrderBookMarketType } from "@/lib/orderbook";

type Props = {
  symbol: string;
  enabled: boolean;
  marketType?: OrderBookMarketType;
  /** Baris per sisi. 12-15 nyaman dibaca tanpa scroll. */
  rows?: number;
  intervalMs?: number;
  className?: string;
};

const fmtPrice = (v: number) => {
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtSize = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}K`;
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
};

function Row({
  level,
  side,
  maxTotal,
}: {
  level: OrderBookLevel;
  side: "ask" | "bid";
  maxTotal: number;
}) {
  // Depth bar: lebar proporsional terhadap total kumulatif terbesar di buku.
  const pct = maxTotal > 0 ? Math.min((level.total / maxTotal) * 100, 100) : 0;
  return (
    <div className="relative grid grid-cols-3 gap-2 px-2 py-[3px] font-mono text-[11px] leading-tight tabular-nums">
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 right-0 transition-[width] duration-300 ease-out",
          side === "ask" ? "bg-red-500/10 dark:bg-red-500/15" : "bg-emerald-500/10 dark:bg-emerald-500/15",
        )}
        style={{ width: `${pct}%` }}
      />
      <span
        className={cn(
          "relative z-10",
          side === "ask" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {fmtPrice(level.price)}
      </span>
      <span className="relative z-10 text-right text-slate-700 dark:text-zinc-300">
        {fmtSize(level.size)}
      </span>
      <span className="relative z-10 text-right text-slate-400 dark:text-zinc-500">
        {fmtSize(level.total)}
      </span>
    </div>
  );
}

export function OrderBook({
  symbol,
  enabled,
  marketType = "spot",
  rows = 12,
  intervalMs = 1500,
  className,
}: Props) {
  const { book, loading, error, ticks } = useOrderBook(symbol, {
    enabled,
    marketType,
    depth: Math.min(rows + 8, 50),
    intervalMs,
  });

  const ok = book?.status === "ok";
  // Asks dibalik supaya best ask duduk tepat di atas harga tengah — konvensi
  // order book profesional (harga termahal di puncak).
  const asks = ok ? book!.asks.slice(0, rows).reverse() : [];
  const bids = ok ? book!.bids.slice(0, rows) : [];
  const maxTotal = book?.max_total ?? 0;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Order Book</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400">
            {marketType === "futures" ? "Perp" : "Spot"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {ticks > 0 && !error && (
            <Radio
              key={ticks}
              className="w-3 h-3 text-emerald-500 animate-pulse"
              aria-label="live"
            />
          )}
          <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
            {book?.pair ?? symbol}
          </span>
        </div>
      </div>

      {/* Kolom */}
      <div className="grid grid-cols-3 gap-2 px-2 py-1.5 border-b border-slate-100 dark:border-zinc-800/60 text-[10px] uppercase tracking-wider text-slate-400 dark:text-zinc-500">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Body */}
      {!ok ? (
        <div className="flex-1 min-h-[220px] flex flex-col items-center justify-center gap-2 px-4 text-center">
          {loading && !error ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
              <span className="text-xs text-slate-500 dark:text-zinc-400">Memuat order book…</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Order book tidak tersedia
              </span>
              <span className="text-[11px] text-slate-500 dark:text-zinc-500 max-w-[220px]">
                {error ?? book?.error?.message ?? "Bursa tidak mengembalikan data."}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center">
          {/* ASKS (merah, di atas) */}
          <div className="flex flex-col">
            {asks.map((lv) => (
              <Row key={`a-${lv.price}`} level={lv} side="ask" maxTotal={maxTotal} />
            ))}
          </div>

          {/* Harga tengah + spread */}
          <div className="flex items-baseline justify-between gap-2 px-2 py-2 my-0.5 border-y border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
            <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
              {book!.mid_price != null ? fmtPrice(book!.mid_price) : "—"}
            </span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400">
              spread {book!.spread != null ? fmtPrice(book!.spread) : "—"}
              {book!.spread_pct != null && ` (${book!.spread_pct.toFixed(3)}%)`}
            </span>
          </div>

          {/* BIDS (hijau, di bawah) */}
          <div className="flex flex-col">
            {bids.map((lv) => (
              <Row key={`b-${lv.price}`} level={lv} side="bid" maxTotal={maxTotal} />
            ))}
          </div>
        </div>
      )}

      {/* Footer: jujur soal asal & umur data */}
      <div className="px-3 py-1.5 border-t border-slate-100 dark:border-zinc-800/60 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 dark:text-zinc-600">
          {ok ? `${book!.source} · L2 depth` : "—"}
        </span>
        <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-600">
          {book?.as_of ? new Date(book.as_of).toLocaleTimeString("id-ID") : ""}
        </span>
      </div>
    </div>
  );
}
