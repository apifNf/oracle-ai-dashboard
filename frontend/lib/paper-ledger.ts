// Paper-trade ledger — persist di localStorage browser user.
//
// KENAPA localStorage, bukan backend:
//   Paper trade adalah SIMULASI milik satu pengguna. Menyimpannya di localStorage
//   membuatnya bertahan walau file TradeStore server ter-reset (mis. redeploy
//   Render), sejalan dengan arsitektur non-custodial ORACLE. Setiap objek diberi
//   `tradeType: "PAPER"` supaya Journal bisa membedakannya dari eksekusi LIVE.
//
// Backend tetap memvalidasi & memberi `id` saat eksekusi; di sinilah objeknya
// dicermin. Close paper dihitung di sisi klien terhadap harga live.

export const PAPER_LEDGER_KEY = "oracle_paper_ledger";
export const PAPER_LEDGER_EVENT = "oracle:paper-ledger-updated";

export type PaperTrade = {
  id: string;
  tradeType: "PAPER";
  symbol: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "CLOSED";
  entry_price: number;
  filled_price: number | null;
  stop_loss_price: number;
  take_profit_targets: number[];
  position_size_coin: number;
  notional_usdt: number;
  allocated_margin_usdt: number;
  applied_leverage: number;
  created_at: string;
  closed_at?: string;
  exit_price?: number;
  realized_pnl_usdt?: number;
  /** Bursa/pasar yang jadi acuan simulasi (kosmetik, tidak menyentuh akun asli). */
  market_type?: string;
  exchange_id?: string;
};

/** Bentuk minimum yang cukup untuk dibaca dari respons /trade/execute. */
type BackendTradeLike = {
  id?: string;
  symbol: string;
  side: "BUY" | "SELL";
  status?: string;
  entry_price: number;
  filled_price?: number | null;
  stop_loss_price: number;
  take_profit_targets?: number[];
  position_size_coin: number;
  notional_usdt: number;
  allocated_margin_usdt: number;
  applied_leverage: number;
  created_at?: string;
  closed_at?: string;
  exit_price?: number;
  realized_pnl_usdt?: number;
  market_type?: string;
  exchange_id?: string;
};

function read(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PAPER_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Buang entri yang tidak berbentuk trade — data lama / rusak tidak boleh
    // menjatuhkan render Journal.
    return parsed.filter(
      (t): t is PaperTrade =>
        t && typeof t.id === "string" && typeof t.symbol === "string" && typeof t.entry_price === "number",
    );
  } catch {
    return [];
  }
}

function write(list: PaperTrade[]): void {
  try {
    localStorage.setItem(PAPER_LEDGER_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(PAPER_LEDGER_EVENT));
  } catch {
    /* storage penuh / diblokir — abaikan, Journal tetap jalan dari state */
  }
}

export function getPaperTrades(): PaperTrade[] {
  // Terbaru dulu.
  return read().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

function normalize(t: BackendTradeLike): PaperTrade {
  return {
    id: t.id || `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tradeType: "PAPER",
    symbol: t.symbol,
    side: t.side,
    status: t.status === "CLOSED" ? "CLOSED" : "OPEN",
    entry_price: t.entry_price,
    filled_price: t.filled_price ?? t.entry_price,
    stop_loss_price: t.stop_loss_price,
    take_profit_targets: Array.isArray(t.take_profit_targets) ? t.take_profit_targets : [],
    position_size_coin: t.position_size_coin,
    notional_usdt: t.notional_usdt,
    allocated_margin_usdt: t.allocated_margin_usdt,
    applied_leverage: t.applied_leverage,
    created_at: t.created_at || new Date().toISOString(),
    closed_at: t.closed_at,
    exit_price: t.exit_price,
    realized_pnl_usdt: t.realized_pnl_usdt,
    market_type: t.market_type,
    exchange_id: t.exchange_id,
  };
}

/** Simpan satu paper trade (dipanggil tepat setelah eksekusi Paper Trade). */
export function addPaperTrade(t: BackendTradeLike): PaperTrade {
  const record = normalize(t);
  const list = read().filter((x) => x.id !== record.id);
  list.push(record);
  write(list);
  return record;
}

/**
 * Rekonsiliasi: pakai daftar paper trade dari backend (bila TradeStore masih
 * hidup) untuk menambal apa pun yang belum ada di localStorage — mis. history
 * paper dari sesi lama sebelum fitur ini ada. Tidak menimpa entri yang sudah
 * CLOSED secara lokal.
 */
export function syncPaperTrades(backendPaper: BackendTradeLike[]): PaperTrade[] {
  const byId = new Map(read().map((t) => [t.id, t]));
  for (const raw of backendPaper) {
    if (!raw.id) continue;
    const local = byId.get(raw.id);
    if (!local) {
      byId.set(raw.id, normalize(raw));
    } else if (local.status === "OPEN" && raw.status === "CLOSED") {
      // Ditutup di tempat lain (mis. tab lain lewat backend) — ikutkan.
      byId.set(raw.id, { ...local, ...normalize(raw) });
    }
  }
  const merged = [...byId.values()];
  write(merged);
  return merged.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/** Tutup paper trade di sisi klien (PnL sudah dihitung pemanggil vs harga live). */
export function closePaperTrade(
  id: string,
  exitPrice: number,
  pnlUsdt: number,
): PaperTrade | null {
  const list = read();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0 || list[idx].status === "CLOSED") return null;
  list[idx] = {
    ...list[idx],
    status: "CLOSED",
    exit_price: exitPrice,
    realized_pnl_usdt: Math.round(pnlUsdt * 1e4) / 1e4,
    closed_at: new Date().toISOString(),
  };
  write(list);
  return list[idx];
}

export function clearPaperLedger(): void {
  write([]);
}
