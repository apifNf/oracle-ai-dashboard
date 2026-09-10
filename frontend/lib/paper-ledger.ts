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

/**
 * Biaya taker simulasi, 0.1% dari notional PER SISI (buka dan tutup).
 *
 * Tanpa ini paper trading berbohong: strategi scalping yang "profit" di
 * simulasi tanpa biaya sering rugi begitu fee bursa masuk hitungan. Angka
 * 0.1% adalah taker fee tier dasar yang umum di Bybit/OKX/Binance spot.
 */
export const PAPER_FEE_RATE = 0.001;

/** Fee satu sisi: 0.1% x (harga x ukuran). */
export function sideFee(price: number, size: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(size)) return 0;
  return Math.abs(price * size) * PAPER_FEE_RATE;
}

/**
 * Fee bolak-balik yang WAJIB diperhitungkan pada posisi yang masih terbuka:
 * user tetap harus membayar sisi keluar, jadi floating PnL yang tidak
 * menguranginya adalah ilusi profit.
 */
export function roundTripFee(entryPrice: number, currentPrice: number, size: number): number {
  return sideFee(entryPrice, size) + sideFee(currentPrice, size);
}

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
  /** PnL SEBELUM biaya — disimpan agar dampak fee bisa ditelusuri. */
  gross_pnl_usdt?: number;
  /** Fee simulasi sisi masuk, dibebankan saat trade dibuka. */
  fee_open_usdt: number;
  /** Fee simulasi sisi keluar, dibebankan saat trade ditutup. */
  fee_close_usdt?: number;
  /** PnL BERSIH setelah kedua fee — inilah yang ditampilkan Jurnal. */
  realized_pnl_usdt?: number;
  /** Catatan otomatis yang dibuat saat posisi ditutup. */
  notes?: string;
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
  gross_pnl_usdt?: number;
  fee_open_usdt?: number;
  fee_close_usdt?: number;
  realized_pnl_usdt?: number;
  notes?: string;
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
    gross_pnl_usdt: t.gross_pnl_usdt,
    // Fee masuk dibebankan begitu posisi dibuka, seperti di bursa sungguhan.
    fee_open_usdt:
      t.fee_open_usdt ?? sideFee(t.filled_price ?? t.entry_price, t.position_size_coin),
    fee_close_usdt: t.fee_close_usdt,
    realized_pnl_usdt: t.realized_pnl_usdt,
    notes: t.notes,
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

/** PnL kotor (belum dipotong fee) pada satu harga keluar. */
export function grossPnl(t: PaperTrade, exitPrice: number): number {
  const entry = t.filled_price ?? t.entry_price;
  const size = t.position_size_coin;
  return t.side === "BUY" ? (exitPrice - entry) * size : (entry - exitPrice) * size;
}

/**
 * Tutup paper trade di sisi klien.
 *
 * PnL dihitung DI SINI, bukan diterima dari pemanggil — supaya tidak ada jalur
 * yang bisa menyimpan angka tanpa potongan fee. Yang tersimpan di
 * `realized_pnl_usdt` selalu PnL BERSIH.
 */
export function closePaperTrade(id: string, exitPrice: number): PaperTrade | null {
  const list = read();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0 || list[idx].status === "CLOSED") return null;

  const t = list[idx];
  const gross = grossPnl(t, exitPrice);
  const feeOpen = t.fee_open_usdt ?? sideFee(t.filled_price ?? t.entry_price, t.position_size_coin);
  const feeClose = sideFee(exitPrice, t.position_size_coin);
  const net = gross - feeOpen - feeClose;
  const round = (n: number) => Math.round(n * 1e4) / 1e4;

  const closed: PaperTrade = {
    ...t,
    status: "CLOSED",
    exit_price: exitPrice,
    gross_pnl_usdt: round(gross),
    fee_open_usdt: round(feeOpen),
    fee_close_usdt: round(feeClose),
    realized_pnl_usdt: round(net),
    closed_at: new Date().toISOString(),
  };
  closed.notes = buildAutoNote(closed);

  list[idx] = closed;
  write(list);
  return closed;
}

/**
 * Catatan jurnal otomatis.
 *
 * Ini BUKAN model bahasa — murni aturan deterministik atas angka trade yang
 * sudah terjadi (arah, R-multiple terhadap jarak SL, apakah menyentuh TP/SL,
 * dan seberapa besar fee menggerus hasil). Sengaja begitu: catatan jurnal
 * harus bisa diaudit user, dan kalimat yang "terdengar analitis" tapi dikarang
 * model justru menyesatkan saat dibaca ulang berbulan-bulan kemudian.
 */
export function buildAutoNote(t: PaperTrade): string {
  const entry = t.filled_price ?? t.entry_price;
  const exit = t.exit_price ?? entry;
  const net = t.realized_pnl_usdt ?? 0;
  const gross = t.gross_pnl_usdt ?? net;
  const fees = (t.fee_open_usdt ?? 0) + (t.fee_close_usdt ?? 0);
  const dir = t.side === "BUY" ? "LONG" : "SHORT";

  // R-multiple: hasil dibagi risiko awal (jarak entry->SL).
  const riskPerUnit = Math.abs(entry - t.stop_loss_price);
  const r = riskPerUnit > 0 ? gross / (riskPerUnit * t.position_size_coin) : null;

  // Apakah keluar di area TP / SL?
  const tp1 = t.take_profit_targets?.[0];
  const hitTp =
    typeof tp1 === "number" && (t.side === "BUY" ? exit >= tp1 : exit <= tp1);
  const hitSl = t.side === "BUY" ? exit <= t.stop_loss_price : exit >= t.stop_loss_price;

  const outcome = hitTp
    ? "closed at take-profit target"
    : hitSl
    ? "stopped out at structural invalidation"
    : net >= 0
    ? "closed manually in profit before target"
    : "closed manually below entry";

  const parts = [
    `Executed via Fable 5 AI (paper). ${dir} ${t.symbol} @ ${entry.toFixed(4)}`,
    `exit ${exit.toFixed(4)} — ${outcome}.`,
    r !== null ? `Result ${r >= 0 ? "+" : ""}${r.toFixed(2)}R gross.` : "",
    `Net ${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(2)} after $${fees.toFixed(2)} simulated fees.`,
    // Sinyal yang paling sering luput: fee memakan seluruh keuntungan.
    gross > 0 && net <= 0 ? "Fees erased the gross profit — size or target was too small." : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export function clearPaperLedger(): void {
  write([]);
}
