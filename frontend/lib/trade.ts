// Client helpers untuk Trade Execution Engine (Tugas 2).

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export type TradeSide = "BUY" | "SELL";
export type TradeMode = "PAPER_TRADING" | "LIVE_BINANCE";

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
  binance_testnet: boolean;
};

export type TradeRecord = {
  id: string;
  account_id: string;
  mode: TradeMode;
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
  params: ProposalParams & { mode: TradeMode; confirm: boolean; dry_run?: boolean },
) {
  return post("/api/v1/trade/execute", params);
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
