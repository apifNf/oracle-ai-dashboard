// Client helpers untuk Trade Execution Engine (Tugas 2).

import { getExchangeCredentials, getWorkspace } from "@/lib/workspace";
import { addPaperTrade } from "@/lib/paper-ledger";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export type TradeSide = "BUY" | "SELL";
// "PAPER_TRADING" = simulasi; "LIVE" = order sungguhan ke bursa pilihan user
// (backend menerjemahkan ke mode "LIVE_<EXCHANGE>", mis. "LIVE_OKX").
export type TradeMode = "PAPER_TRADING" | "LIVE";
export type MarketType = "spot" | "futures";

export type ProposalParams = {
  account_id: string;
  symbol: string;
  side: TradeSide;
  stop_loss: number;
  take_profit?: number[];
  entry_price?: number | null;
  risk_pct?: number | null;
  leverage?: number | null;
  order_type?: "MARKET" | "LIMIT";
};

export type TradeProposal = {
  symbol: string;
  side: TradeSide;
  order_type: string;
  entry_price: number;
  stop_loss_price: number;
  take_profit_targets: number[];
  sl_distance_pct: number;
  position_size_coin: number;
  notional_usdt: number;
  estimated_margin_usdt: number;
  applied_leverage: number;
  applied_risk_pct: number;
  risk_amount_usdt: number;
  risk_reward_ratio: number[];
  primary_rr: number | null;
  equity_usdt: number;
  guardrail_caps: string;
};

export type TradeConfig = {
  paper_start_balance_usdt: number;
  max_risk_pct: number;
  leverage_cap: number;
  max_notional_usdt: number;
  live_enabled: boolean;
  exchange_testnet: boolean;
  binance_testnet?: boolean;
  default_exchange_id?: string;
  default_market_type?: string;
  supported_exchanges?: { id: string; label: string }[];
};

export type TradeRecord = {
  id: string;
  account_id: string;
  mode: string; // "PAPER_TRADING" | "LIVE_<EXCHANGE>"
  exchange_id?: string;
  exchange_label?: string;
  market_type?: string;
  symbol: string;
  side: TradeSide;
  status: "OPEN" | "CLOSED" | "DRY_RUN";
  entry_price: number;
  filled_price?: number | null;
  stop_loss_price: number;
  take_profit_targets: number[];
  position_size_coin: number;
  notional_usdt: number;
  allocated_margin_usdt: number;
  applied_leverage: number;
  applied_risk_pct: number;
  risk_reward_ratio: number[];
  guardrail_caps: string;
  exchange_ref?: string | null;
  realized_pnl_usdt?: number;
  exit_price?: number;
  created_at: string;
  closed_at?: string;
};

async function post(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchTradeConfig(): Promise<TradeConfig> {
  const res = await fetch(`${API_BASE}/api/v1/trade/config`);
  const data = await res.json();
  return data;
}

export async function fetchProposal(params: ProposalParams): Promise<TradeProposal> {
  const data = await post("/api/v1/trade/propose", params);
  return data.proposal;
}

export async function executeTrade(
  params: ProposalParams & {
    mode: TradeMode;
    confirm: boolean;
    dry_run?: boolean;
    exchange_id?: string;   // binance|okx|bybit|mexc|indodax (Workspace Config)
    market_type?: MarketType;
    // Kredensial bursa milik user. Kalau tidak dikirim eksplisit, diambil
    // otomatis dari localStorage (Settings → Workspace Configuration).
    api_key?: string;
    secret_key?: string;
    passphrase?: string;
  },
) {
  // SaaS publik / non-custodial: order LIVE dikirim memakai kunci bursa milik
  // user sendiri. Diambil di sini — satu choke point — supaya semua pemanggil
  // (AI Chat ticket, Scanner ticket, dst.) ikut terlayani tanpa duplikasi.
  // Paper trading tidak menyentuh bursa, jadi kuncinya tidak pernah dikirim.
  if (params.mode === "PAPER_TRADING") {
    const { api_key, secret_key, passphrase, ...safe } = params;
    const res = await post("/api/v1/trade/execute", safe);
    // Smart Journal: cermin paper trade ke localStorage begitu tereksekusi,
    // supaya bertahan walau TradeStore server ter-reset dan bisa diberi badge
    // "PAPER" di halaman Journal. Kegagalan menulis tidak boleh menggagalkan
    // eksekusi yang sudah sukses di server.
    try {
      const t = res?.trade;
      if (t && t.symbol) {
        addPaperTrade({
          ...t,
          market_type: params.market_type,
          exchange_id: params.exchange_id,
        });
      }
    } catch {
      /* ignore */
    }
    return res;
  }

  const stored = getExchangeCredentials();
  const body = {
    ...params,
    api_key: params.api_key ?? stored.api_key,
    secret_key: params.secret_key ?? stored.secret_key,
    passphrase: params.passphrase ?? stored.passphrase,
  };
  return post("/api/v1/trade/execute", body);
}

// --------------------------------------------------------------------------- //
// Smart Journal — snapshot akun bursa asli (READ-ONLY)
// --------------------------------------------------------------------------- //

export type ExchangePosition = {
  symbol: string;
  side: string | null;
  contracts: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  leverage: number | null;
  notional: number;
};

// --------------------------------------------------------------------------- //
// API Key Permission Interceptor
// --------------------------------------------------------------------------- //

export type KeyValidationState = "safe" | "unsafe" | "unknown" | "invalid";

export type KeyValidation = {
  state: KeyValidationState;
  exchange_id: string;
  withdraw: boolean | null;
  transfer: boolean | null;
  read_only: boolean | null;
  checked_via: string;
  matched_permissions: string[];
  message: string;
};

/**
 * Tanya backend apakah kunci ini boleh disimpan.
 *
 * Backend membalas 403 kalau izin withdraw/transfer masih aktif dan 400 kalau
 * bursa menolak kuncinya — keduanya dinormalisasi jadi objek KeyValidation
 * supaya pemanggil menangani satu bentuk saja. Kegagalan jaringan menjadi
 * "unknown": TIDAK memblokir user, tapi juga TIDAK mengklaim kunci aman.
 */
export async function validateExchangeKeys(params: {
  exchange_id: string;
  api_key: string;
  secret_key: string;
  passphrase?: string;
}): Promise<KeyValidation> {
  const fallback = (state: KeyValidationState, message: string): KeyValidation => ({
    state,
    exchange_id: params.exchange_id,
    withdraw: null,
    transfer: null,
    read_only: null,
    checked_via: "client",
    matched_permissions: [],
    message,
  });

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/trade/validate-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    return fallback("unknown", "Server validasi ORACLE tidak bisa dihubungi.");
  }

  const body = await res.json().catch(() => null);
  // 403/400 membawa payload verdict di `detail`.
  const payload = body?.detail && typeof body.detail === "object" ? body.detail : body;
  if (payload && typeof payload.state === "string") return payload as KeyValidation;

  if (res.ok) return fallback("unknown", "Respons validasi tidak dikenali.");
  return fallback(
    res.status === 403 ? "unsafe" : res.status === 400 ? "invalid" : "unknown",
    typeof body?.detail === "string" ? body.detail : `HTTP ${res.status}`,
  );
}

export type ExchangeAccount = {
  status: "ok" | "unavailable";
  exchange_id: string;
  exchange_label: string;
  market_type: string;
  balance: {
    by_coin: Record<string, { free: number; total: number }>;
    stable_total_usd: number;
    stable_free_usd: number;
  } | null;
  positions: ExchangePosition[];
  error: { code: string; message: string } | null;
};

/**
 * Saldo + posisi dari akun bursa milik user. Hanya dipanggil bila user SUDAH
 * menyimpan API Key + Secret (+ passphrase bila perlu) — kalau belum, return
 * null dan Journal jatuh ke "Virtual Balance $10,000".
 */
export async function fetchExchangeAccount(): Promise<ExchangeAccount | null> {
  const ws = getWorkspace();
  const creds = getExchangeCredentials();
  if (!creds.api_key.trim() || !creds.secret_key.trim()) return null;
  try {
    const data = await post("/api/v1/trade/exchange-account", {
      exchange_id: ws.exchange,
      market_type: ws.environment,
      api_key: creds.api_key,
      secret_key: creds.secret_key,
      passphrase: creds.passphrase,
    });
    return data as ExchangeAccount;
  } catch {
    return null;
  }
}

export async function fetchJournal(accountId: string, limit = 100) {
  const res = await fetch(
    `${API_BASE}/api/v1/trade/journal?account_id=${encodeURIComponent(accountId)}&limit=${limit}`,
  );
  return res.json();
}

export async function fetchAccount(accountId: string) {
  const res = await fetch(
    `${API_BASE}/api/v1/trade/account?account_id=${encodeURIComponent(accountId)}`,
  );
  return res.json();
}

export async function closeTrade(accountId: string, tradeId: string, exitPrice?: number) {
  return post("/api/v1/trade/close", {
    account_id: accountId,
    trade_id: tradeId,
    exit_price: exitPrice ?? null,
  });
}

/** Harga pasar live untuk satu simbol (dipakai Journal saat menutup posisi). */
export async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/trade/price?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.price === "number" ? data.price : null;
  } catch {
    return null;
  }
}

/** Harga live batch untuk polling floating PnL — key = simbol Binance (BTCUSDT). */
export async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const uniq = Array.from(new Set(symbols.filter(Boolean)));
  if (uniq.length === 0) return {};
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/trade/prices?symbols=${encodeURIComponent(uniq.join(","))}`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data?.prices && typeof data.prices === "object" ? data.prices : {};
  } catch {
    return {};
  }
}

/**
 * Cari blok proposal `@@ORACLE_PROPOSAL@@ {json}` di akhir respons AI.
 * Return params untuk TradeProposalTicket + teks yang sudah dibersihkan dari blok.
 */
export function extractProposalFromText(
  text: string,
  accountId: string,
): { params: ProposalParams | null; cleanedText: string } {
  if (!text) return { params: null, cleanedText: text };
  const re = /@@ORACLE_PROPOSAL@@\s*(\{[\s\S]*?\})\s*$/m;
  const m = text.match(re);
  if (!m) return { params: null, cleanedText: text };

  const cleanedText = text.replace(m[0], "").trimEnd();
  try {
    const raw = JSON.parse(m[1]);
    const side: TradeSide = String(raw.side).toUpperCase() === "SELL" ? "SELL" : "BUY";
    const asset = String(raw.asset || "").toUpperCase().replace("/", "");
    const sl = Number(raw.sl);
    if (!asset || !Number.isFinite(sl) || sl <= 0) {
      return { params: null, cleanedText };
    }
    const tp = Array.isArray(raw.tp)
      ? raw.tp.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const entry = Number(raw.entry);
    return {
      params: {
        account_id: accountId,
        symbol: asset.endsWith("USDT") ? asset : `${asset}USDT`,
        side,
        stop_loss: sl,
        take_profit: tp,
        entry_price: Number.isFinite(entry) && entry > 0 ? entry : null,
        order_type: "MARKET",
      },
      cleanedText,
    };
  } catch {
    return { params: null, cleanedText };
  }
}

/**
 * Turunkan parameter proposal dari keputusan FABLE 5 (execution mode).
 * order_payload tidak memuat entry price -> server yang mengisi (harga acuan).
 */
export function proposalParamsFromDecision(
  decision: any,
  accountId: string,
): ProposalParams | null {
  const op = decision?.order_payload;
  if (!op || decision?.execution_status === "DENIED") return null;
  const action: string = op.action || "";
  const side: TradeSide =
    action === "SELL_OPEN" ? "SELL" : action === "BUY_OPEN" ? "BUY" : "BUY";
  const sl = op?.risk_management?.stop_loss_price;
  if (action === "LIQUIDATE_ALL" || !sl || sl <= 0) return null;
  return {
    account_id: accountId,
    symbol: (op.symbol || "").replace("/", "") || "BTCUSDT",
    side,
    stop_loss: sl,
    take_profit: op?.risk_management?.take_profit_targets || [],
    leverage: op.applied_leverage || null,
    order_type: op.order_type === "LIMIT" ? "LIMIT" : "MARKET",
  };
}

/** Default SL/TP dari kartu scanner (LONG/SHORT) — struktur EMA + buffer 2%/4%. */
export function proposalParamsFromSignal(
  sig: { coin: string; signal: string | null; price: number | null; ema50: number | null },
  accountId: string,
): ProposalParams | null {
  if (!sig.price || (sig.signal !== "LONG" && sig.signal !== "SHORT")) return null;
  const side: TradeSide = sig.signal === "LONG" ? "BUY" : "SELL";
  const price = sig.price;
  const ema50 = sig.ema50 ?? null;
  let sl: number;
  let tp: number[];
  if (side === "BUY") {
    sl = ema50 && ema50 < price ? Math.min(ema50, price * 0.985) : price * 0.98;
    tp = [price * 1.03, price * 1.06];
  } else {
    sl = ema50 && ema50 > price ? Math.max(ema50, price * 1.015) : price * 1.02;
    tp = [price * 0.97, price * 0.94];
  }
  return {
    account_id: accountId,
    symbol: `${sig.coin}USDT`,
    side,
    entry_price: price,
    stop_loss: Number(sl.toFixed(8)),
    take_profit: tp.map((t) => Number(t.toFixed(8))),
  };
}
