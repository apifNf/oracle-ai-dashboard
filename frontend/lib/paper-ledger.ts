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
  /** Harga terbaik yang pernah dicapai posisi (high-water mark) — dasar trailing. */
  hwm_price?: number;
  /** Tier proteksi SL yang sudah aktif: BEP | TRAIL | CONTINUOUS. */
  protection_tier?: "BEP" | "TRAIL" | "CONTINUOUS";
  /** SL awal sebelum digeser watchdog — untuk audit. */
  initial_stop_loss?: number;
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

/* ========================================================================= *
 * Smart Auto-BEP & Trailing Stop
 *
 * Metrik pemicu: ROE (Return on Equity) = floating PnL / margin dialokasikan,
 * dalam persen. Dipakai ROE, bukan persentase harga, karena itulah yang
 * dirasakan trader dan sudah memperhitungkan leverage (ROE = gerak_harga% x lev).
 *
 * Aturan pergeseran SL — SEMUA arah-sadar (LONG: SL naik, SHORT: SL turun):
 *   TIER 1  BEP        : ROE >= +10%  -> SL ke harga ENTRY (kunci modal)
 *   TIER 2  TRAIL      : ROE >= +20%  -> SL ke harga yang setara ROE +5%
 *   CONTINUOUS         : SL mengekor ~12.5% ROE di belakang ROE tertinggi
 *                        yang pernah dicapai (high-water mark)
 *
 * RATCHET: SL hanya boleh bergerak ke arah yang MENGAMANKAN, tidak pernah
 * mundur. LONG -> hanya naik; SHORT -> hanya turun. SL tidak pernah
 * ditempatkan melewati harga sekarang.
 * ========================================================================= */

export const BEP_TRIGGER_ROE = 10;       // TIER 1
export const TRAIL_TRIGGER_ROE = 20;     // TIER 2
export const TRAIL_LOCK_ROE = 5;         // profit yang dikunci di TIER 2
// Jarak trailing di belakang high-water mark, dalam poin ROE. Dipilih 15 (ujung
// atas rentang "10–15%") supaya tiernya MENYAMBUNG mulus: pada HWM = +20% ROE,
// trailing mengunci tepat +5% — sama dengan TIER 2 — lalu terus naik di atasnya.
// Nilai lebih kecil akan membuat CONTINUOUS "melompati" TIER 2 di ambang +20%.
export const CONTINUOUS_GAP_ROE = 15;

export type SmartStopResult = {
  /** high-water mark harga terbaru (selalu dikembalikan, walau SL tak bergerak). */
  hwm_price: number;
  /** SL setelah evaluasi (== SL lama kalau tidak ada pergeseran). */
  new_sl: number;
  /** apakah SL benar-benar bergeser pada evaluasi ini. */
  moved: boolean;
  /** tier yang memicu pergeseran, kalau ada. */
  tier: "BEP" | "TRAIL" | "CONTINUOUS" | null;
  /** ROE (%) yang dikunci SL baru — untuk teks notifikasi. */
  locked_roe: number | null;
};

/**
 * Hitung SL baru untuk satu posisi pada harga terkini. Fungsi MURNI — tidak
 * menyentuh storage. Return null kalau tidak ada yang berubah (SL tetap, HWM
 * tetap).
 */
export function evaluateSmartStop(
  t: Pick<
    PaperTrade,
    | "side"
    | "entry_price"
    | "filled_price"
    | "stop_loss_price"
    | "position_size_coin"
    | "allocated_margin_usdt"
    | "hwm_price"
  >,
  currentPrice: number,
): SmartStopResult | null {
  const entry = t.filled_price ?? t.entry_price;
  const size = t.position_size_coin;
  const margin = t.allocated_margin_usdt;
  const curSl = t.stop_loss_price;
  const isLong = t.side === "BUY";

  if (
    !(entry > 0) || !(size > 0) || !(margin > 0) || !(currentPrice > 0)
  ) {
    return null;
  }

  const pnlAt = (p: number) => (isLong ? p - entry : entry - p) * size;
  const roeAt = (p: number) => (pnlAt(p) / margin) * 100;
  // Harga di mana ROE posisi ini sama dengan `roe` persen.
  const priceForRoe = (roe: number) =>
    isLong
      ? entry + (roe / 100) * (margin / size)
      : entry - (roe / 100) * (margin / size);

  const curRoe = roeAt(currentPrice);

  // High-water mark: harga TERBAIK yang pernah dicapai (arah favorable).
  const prevHwm = t.hwm_price ?? entry;
  const hwmPrice = isLong
    ? Math.max(prevHwm, currentPrice)
    : Math.min(prevHwm, currentPrice);
  const hwmRoe = roeAt(hwmPrice);

  // Kandidat level SL (dalam harga). Pilih yang PALING protektif & valid.
  const candidates: { price: number; tier: SmartStopResult["tier"] }[] = [];
  if (curRoe >= BEP_TRIGGER_ROE) {
    candidates.push({ price: entry, tier: "BEP" });
  }
  if (curRoe >= TRAIL_TRIGGER_ROE) {
    candidates.push({ price: priceForRoe(TRAIL_LOCK_ROE), tier: "TRAIL" });
  }
  // CONTINUOUS aktif begitu HWM cukup tinggi sehingga trailing masih di area
  // profit (di atas kunci TIER 2).
  if (hwmRoe - CONTINUOUS_GAP_ROE > TRAIL_LOCK_ROE) {
    candidates.push({
      price: priceForRoe(hwmRoe - CONTINUOUS_GAP_ROE),
      tier: "CONTINUOUS",
    });
  }

  let best = curSl;
  let bestTier: SmartStopResult["tier"] = null;
  for (const c of candidates) {
    // Jangan pernah taruh SL melewati harga sekarang.
    const behindPrice = isLong ? c.price < currentPrice : c.price > currentPrice;
    if (!behindPrice) continue;
    // Ratchet: hanya bergerak ke arah aman.
    const improves = isLong ? c.price > best : c.price < best;
    if (improves) {
      best = c.price;
      bestTier = c.tier;
    }
  }

  const round = (n: number) => Math.round(n * 1e8) / 1e8;
  const moved = round(best) !== round(curSl);
  const hwmChanged = round(hwmPrice) !== round(prevHwm);
  if (!moved && !hwmChanged) return null;

  return {
    hwm_price: round(hwmPrice),
    new_sl: round(best),
    moved,
    tier: moved ? bestTier : null,
    locked_roe: moved ? Math.round(roeAt(best) * 10) / 10 : null,
  };
}

/**
 * Terapkan evaluasi Smart Stop ke satu paper trade di localStorage.
 * Dipanggil watchdog frontend tiap tick harga. Mengembalikan hasil evaluasi
 * (untuk toast) atau null kalau tidak ada perubahan / trade tidak layak.
 */
export function applySmartStop(
  id: string,
  currentPrice: number,
): SmartStopResult | null {
  const list = read();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0 || list[idx].status !== "OPEN") return null;

  const t = list[idx];
  const res = evaluateSmartStop(t, currentPrice);
  if (!res) return null;

  list[idx] = {
    ...t,
    hwm_price: res.hwm_price,
    ...(res.moved
      ? {
          initial_stop_loss: t.initial_stop_loss ?? t.stop_loss_price,
          stop_loss_price: res.new_sl,
          protection_tier: res.tier ?? t.protection_tier,
        }
      : {}),
  };
  write(list);
  return res;
}
