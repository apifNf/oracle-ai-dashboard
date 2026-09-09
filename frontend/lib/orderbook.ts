// Client helper untuk Order Book Level 2 (on-demand).
//
// Backend sengaja REST per-simbol, bukan langganan global — lihat
// backend/app/services/orderbook_service.py. Frontend hanya boleh memanggil
// ini selama panel/modal yang membutuhkannya terbuka.

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export type OrderBookLevel = {
  price: number;
  size: number;
  /** Kumulatif dari harga terbaik — sudah dihitung server. */
  total: number;
};

export type OrderBookMarketType = "spot" | "futures";

export type OrderBook = {
  status: "ok" | "unavailable";
  symbol: string;
  pair: string;
  market_type: OrderBookMarketType;
  category: string;
  depth: number;
  source: string;
  as_of: string | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  best_bid?: number;
  best_ask?: number;
  mid_price: number | null;
  spread: number | null;
  spread_pct: number | null;
  /** Total terbesar di kedua sisi — dipakai untuk lebar depth bar. */
  max_total: number | null;
  cached?: boolean;
  error: { code: string; message: string } | null;
};

export async function fetchOrderBook(
  symbol: string,
  opts: {
    marketType?: OrderBookMarketType;
    depth?: number;
    signal?: AbortSignal;
  } = {},
): Promise<OrderBook> {
  const { marketType = "spot", depth = 20, signal } = opts;
  const coin = encodeURIComponent(symbol.replace("/", "").toUpperCase());
  const res = await fetch(
    `${API_BASE}/api/v1/scanner/orderbook/${coin}?market_type=${marketType}&depth=${depth}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
