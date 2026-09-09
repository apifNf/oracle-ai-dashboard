"use client";

import { useEffect, useState } from "react";
import { TerminalSquare, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { GlassModal } from "@/components/ui/glass-modal";
import { closeTrade, fetchLivePrice } from "@/lib/trade";

const money = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

// Bentuk minimum yang dibutuhkan modal — cocok untuk TradeRecord & LedgerRow.
type ClosableTrade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  mode: string;
  entry_price: number;
  filled_price?: number | null;
  position_size_coin: number;
  allocated_margin_usdt: number;
};

type Props = {
  trade: ClosableTrade | null;
  accountId: string;
  onCancel: () => void;
  onDone: (result: any | null, error: string | null) => void;
  /**
   * Kalau diberikan, penutupan dihitung & disimpan di sisi klien (paper trade
   * di localStorage) — TIDAK memanggil backend /trade/close.
   */
  onLocalClose?: (exitPrice: number, pnlUsdt: number) => void;
};

/** Modal konfirmasi tutup posisi — glassmorphism, PnL realisasi live. */
export function CloseTradeModal({ trade, accountId, onCancel, onDone, onLocalClose }: Props) {
  const [live, setLive] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!trade) return;
    setLive(null);
    setSubmitting(false);
    let active = true;
    const poll = async () => {
      const p = await fetchLivePrice(trade.symbol);
      if (active && typeof p === "number") setLive(p);
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [trade]);

  if (!trade) return null;

  const isLong = trade.side === "BUY";
  const entry = trade.filled_price ?? trade.entry_price;
  const size = trade.position_size_coin;
  const pnl =
    live === null ? null : isLong ? (live - entry) * size : (entry - live) * size;
  const roe = pnl === null || !trade.allocated_margin_usdt ? null : (pnl / trade.allocated_margin_usdt) * 100;
  const positive = (pnl ?? 0) >= 0;

  const confirm = async () => {
    setSubmitting(true);
    try {
      if (onLocalClose) {
        // Paper trade — hitung & simpan di klien, tanpa backend.
        const exit = live ?? entry;
        const p =
          trade.side === "BUY" ? (exit - entry) * size : (entry - exit) * size;
        onLocalClose(exit, p);
        return;
      }
      const res = await closeTrade(accountId, trade.id, live ?? undefined);
      onDone(res, null);
    } catch (e) {
      onDone(null, e instanceof Error ? e.message : "Gagal menutup posisi");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassModal
      open={!!trade}
      onClose={submitting ? () => {} : onCancel}
      title="Konfirmasi Tutup Posisi"
      icon={<TerminalSquare className="w-4 h-4 text-amber-400" />}
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-xl border border-white/10 py-2.5 px-4 text-sm font-medium text-zinc-400 hover:text-white hover:border-white/20 transition disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={confirm}
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 py-2.5 px-4 font-semibold text-white shadow-lg transition disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? "Menutup…" : "Konfirmasi Tutup"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Badge aset + side */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white tracking-wide">
            {trade.symbol}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
              isLong
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}
          >
            {isLong ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {isLong ? "BUY / LONG" : "SELL / SHORT"}
          </span>
          <span className="ml-auto text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
            {trade.mode === "PAPER_TRADING" ? "Paper" : "Live"} · {size} coin
          </span>
        </div>

        {/* Entry vs Live exit */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Entry Price</p>
            <p className="mt-1 font-mono text-sm text-zinc-200">${money(entry, 4)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              Live Exit Price
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </p>
            <p className="mt-1 font-mono text-sm text-white">
              {live === null ? "memuat…" : `$${money(live, 4)}`}
            </p>
          </div>
        </div>

        {/* Estimasi Realized PnL */}
        <div
          className={`rounded-xl border p-4 text-center ${
            pnl === null
              ? "border-white/10 bg-white/[0.03]"
              : positive
              ? "border-emerald-500/30 bg-emerald-500/[0.06]"
              : "border-rose-500/30 bg-rose-500/[0.06]"
          }`}
        >
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">
            Estimasi Realized PnL
          </p>
          {pnl === null ? (
            <p className="mt-1 text-lg font-mono font-bold text-zinc-500">menghitung…</p>
          ) : (
            <p
              className={`mt-1 text-2xl font-mono font-bold tabular-nums ${
                positive
                  ? "text-emerald-400 [text-shadow:0_0_18px_rgba(52,211,153,0.45)]"
                  : "text-rose-400"
              }`}
            >
              {positive ? "+" : "-"}${money(Math.abs(pnl))}
              {roe !== null && (
                <span className="ml-2 text-sm opacity-80 align-middle">
                  ({roe >= 0 ? "+" : ""}
                  {roe.toFixed(2)}%)
                </span>
              )}
            </p>
          )}
          <p className="mt-1 text-[11px] text-zinc-500">
            Ditutup pada harga pasar live saat ini.
          </p>
        </div>
      </div>
    </GlassModal>
  );
}
