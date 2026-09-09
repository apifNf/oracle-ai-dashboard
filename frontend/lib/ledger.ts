// Smart Journal — gabungkan tiga sumber trade ke satu daftar yang bisa dirender,
// setiap baris ditandai PAPER (simulasi) atau LIVE (akun bursa asli).
//
// Sumber:
//   1. paperTrades   — localStorage (source of truth untuk simulasi)
//   2. backendTrades — /trade/journal, DISARING ke non-paper (histori live)
//   3. exchangeAccount.positions — posisi terbuka asli dari bursa (read-only)
//
// Dibuat sebagai fungsi murni supaya bisa diuji tanpa React.

import type { TradeRecord } from "@/lib/trade";
import type { ExchangeAccount } from "@/lib/trade";
import type { PaperTrade } from "@/lib/paper-ledger";

export type LedgerSource = "paper" | "backend" | "exchange";

export type LedgerRow = {
  id: string;
  tradeType: "PAPER" | "LIVE";
  source: LedgerSource;
  account_id: string;
  mode: string;
  exchange_label?: string;
  market_type?: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "CLOSED" | "DRY_RUN";
  entry_price: number;
  filled_price: number | null;
  stop_loss_price: number;
  take_profit_targets: number[];
  position_size_coin: number;
  notional_usdt: number;
  allocated_margin_usdt: number;
  applied_leverage: number;
  realized_pnl_usdt?: number;
  exit_price?: number;
  created_at: string;
  closed_at?: string;
  /** hanya untuk baris posisi bursa: PnL & harga mark dari bursa itu sendiri. */
  live_unrealized_pnl?: number;
  live_mark_price?: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 'BTC/USDT:USDT' / 'BTC/USDT' -> 'BTCUSDT' (samakan dgn simbol harga live). */
function flatSymbol(s: string): string {
  return (s || "").split(":")[0].replace(/[/\-_]/g, "").toUpperCase();
}

function fromPaper(t: PaperTrade, accountId: string): LedgerRow {
  return {
    id: t.id,
    tradeType: "PAPER",
    source: "paper",
    account_id: accountId,
    mode: "PAPER_TRADING",
    market_type: t.market_type,
    symbol: t.symbol,
    side: t.side,
    status: t.status,
    entry_price: t.entry_price,
    filled_price: t.filled_price ?? t.entry_price,
    stop_loss_price: t.stop_loss_price,
    take_profit_targets: t.take_profit_targets || [],
    position_size_coin: t.position_size_coin,
    notional_usdt: t.notional_usdt,
    allocated_margin_usdt: t.allocated_margin_usdt,
    applied_leverage: t.applied_leverage,
    realized_pnl_usdt: t.realized_pnl_usdt,
    exit_price: t.exit_price,
    created_at: t.created_at,
    closed_at: t.closed_at,
  };
}

function fromBackend(t: TradeRecord): LedgerRow {
  return {
    id: t.id,
    tradeType: "LIVE",
    source: "backend",
    account_id: t.account_id,
    mode: t.mode,
    exchange_label: t.exchange_label,
    market_type: t.market_type,
    symbol: t.symbol,
    side: t.side,
    status: t.status,
    entry_price: t.entry_price,
    filled_price: t.filled_price ?? t.entry_price,
    stop_loss_price: t.stop_loss_price,
    take_profit_targets: t.take_profit_targets || [],
    position_size_coin: t.position_size_coin,
    notional_usdt: t.notional_usdt,
    allocated_margin_usdt: t.allocated_margin_usdt,
    applied_leverage: t.applied_leverage,
    realized_pnl_usdt: t.realized_pnl_usdt,
    exit_price: t.exit_price,
    created_at: t.created_at,
    closed_at: t.closed_at,
  };
}

export function buildUnifiedLedger(opts: {
  paperTrades: PaperTrade[];
  backendTrades: TradeRecord[];
  exchangeAccount: ExchangeAccount | null;
  accountId: string;
}): LedgerRow[] {
  const { paperTrades, backendTrades, exchangeAccount, accountId } = opts;

  const paperRows = paperTrades.map((t) => fromPaper(t, accountId));

  // Backend: hanya baris LIVE. Baris PAPER backend diabaikan — localStorage yang
  // jadi acuan simulasi (kalau tidak, paper trade tampil dobel).
  const backendLive = backendTrades
    .filter((t) => t.mode && t.mode !== "PAPER_TRADING")
    .map(fromBackend);

  // Posisi asli dari bursa. Lewati kalau sudah ada baris backend LIVE yang OPEN
  // untuk simbol+sisi yang sama (hindari dobel).
  const openLiveKeys = new Set(
    backendLive
      .filter((r) => r.status === "OPEN")
      .map((r) => `${flatSymbol(r.symbol)}:${r.side}`),
  );
  const exchangeRows: LedgerRow[] = [];
  const label = exchangeAccount?.exchange_label;
  for (const p of exchangeAccount?.positions ?? []) {
    const side: "BUY" | "SELL" = String(p.side).toUpperCase() === "SELL" ? "SELL" : "BUY";
    const flat = flatSymbol(p.symbol);
    if (openLiveKeys.has(`${flat}:${side}`)) continue;
    const entry = num(p.entry_price);
    const lev = num(p.leverage) || 1;
    const notional = num(p.notional) || entry * num(p.contracts);
    exchangeRows.push({
      id: `pos-${flat}-${side}`,
      tradeType: "LIVE",
      source: "exchange",
      account_id: accountId,
      mode: label ? `LIVE_${label.toUpperCase()}` : "LIVE",
      exchange_label: label,
      market_type: exchangeAccount?.market_type,
      symbol: flat,
      side,
      status: "OPEN",
      entry_price: entry,
      filled_price: entry,
      stop_loss_price: 0,
      take_profit_targets: [],
      position_size_coin: num(p.contracts),
      notional_usdt: notional,
      allocated_margin_usdt: lev ? notional / lev : notional,
      applied_leverage: lev,
      created_at: new Date(0).toISOString(), // posisi bursa tak punya waktu buka
      live_unrealized_pnl: num(p.unrealized_pnl),
      live_mark_price: num(p.mark_price),
    });
  }

  return [...paperRows, ...backendLive, ...exchangeRows].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );
}

export function ledgerFlatSymbol(s: string): string {
  return flatSymbol(s);
}
