"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Globe, TrendingUp, TrendingDown, AlertCircle, Activity, ExternalLink,
  Loader2, Clock, Box, Zap, ArrowRight, Wallet, WifiOff, RefreshCw, Inbox,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

type Impact = "BULLISH" | "BEARISH" | "IMPORTANT" | "NEUTRAL" | null;

type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  image_url: string | null;
  published_at: string;
  impact: Impact;
};

type OnChainItem = {
  id: string;
  event_type: string;
  network: string | null;
  asset: string | null;
  amount_display: string | null;
  from_address: string | null;
  to_address: string | null;
  tx_hash: string | null;
  block_number: number | null;
  status: string;
  received_at: string;
};

/** Amplop yang dikembalikan backend. Frontend membaca `status`, tidak menebak. */
type Envelope<T> = {
  status: "ok" | "empty" | "degraded";
  data: T[];
  count: number;
  as_of: string;
  error: { code: string; message: string } | null;
};

/** Kondisi panel di UI. "error" WAJIB dibedakan dari "empty". */
type PanelState = "loading" | "ok" | "empty" | "error";

const API_BASE = "/api/v1/market-intel";
const ONCHAIN_REFRESH_MS = 30_000;
const NEWS_REFRESH_MS = 120_000;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function shortAddress(value: string | null): string {
  if (!value) return "—";
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Badge status yang jujur. Tidak pernah menampilkan "Live" saat data gagal. */
function FeedBadge({ state, lastOk }: { state: PanelState; lastOk: Date | null }) {
  if (state === "error") {
    return (
      <span className="text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
        <WifiOff className="w-3 h-3" /> Terputus
      </span>
    );
  }
  if (state === "loading") {
    return (
      <span className="text-xs font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3 animate-spin" /> Memuat
      </span>
    );
  }
  const stale = lastOk !== null && Date.now() - lastOk.getTime() > 5 * 60_000;
  if (stale) {
    return (
      <span className="text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Tertunda
      </span>
    );
  }
  return (
    <span className="text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
    </span>
  );
}

function PanelMessage({
  icon, title, detail, onRetry,
}: { icon: React.ReactNode; title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 rounded-xl border border-dashed border-slate-200 dark:border-zinc-800">
      <div className="text-slate-400 dark:text-zinc-600 mb-3">{icon}</div>
      <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">{title}</p>
      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1 max-w-xs">{detail}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hook fetch                                                          */
/* ------------------------------------------------------------------ */

function useFeed<T>(path: string, intervalMs: number) {
  const [items, setItems] = useState<T[]>([]);
  const [state, setState] = useState<PanelState>("loading");
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const [detail, setDetail] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (isInitial: boolean) => {
      // Batalkan request sebelumnya supaya respons lambat tidak menimpa yang baru.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (isInitial) setState("loading");

      try {
        const res = await fetch(`${API_BASE}${path}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const body: Envelope<T> = await res.json();

        // Validasi bentuk. Tanpa ini, respons error akan membuat .map() melempar
        // dan seluruh halaman jadi blank.
        if (!body || !Array.isArray(body.data)) {
          throw new Error("Bentuk respons tidak dikenali");
        }

        if (!mountedRef.current) return;

        if (body.status === "degraded") {
          setState("error");
          setDetail(body.error?.message ?? "Sumber data sedang bermasalah.");
          return; // pertahankan data lama di layar, jangan dikosongkan
        }

        setItems(body.data);
        setLastOk(new Date());
        setState(body.data.length > 0 ? "ok" : "empty");
        setDetail("");
      } catch (err) {
        if (controller.signal.aborted || !mountedRef.current) return;
        // Kegagalan dicatat dan ditampilkan, bukan ditelan diam-diam.
        console.error(`[market-intel] gagal memuat ${path}:`, err);
        setState("error");
        setDetail(
          err instanceof Error ? err.message : "Gangguan jaringan tidak diketahui.",
        );
      }
    },
    [path],
  );

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    const timer = setInterval(() => void load(false), intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load, intervalMs]);

  return { items, state, lastOk, detail, reload: () => void load(true) };
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export default function MarketIntelligencePage() {
  const news = useFeed<NewsItem>("/news", NEWS_REFRESH_MS);
  const chain = useFeed<OnChainItem>("/onchain", ONCHAIN_REFRESH_MS);

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400">
            Market Intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            <Globe className="w-8 h-8 text-emerald-600 dark:text-emerald-500" /> Macro &amp; On-Chain
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        {/* ---------------- KIRI: BERITA ---------------- */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-slate-500 dark:text-zinc-500" /> Alpha News Feed
            </h2>
            <FeedBadge state={news.state} lastOk={news.lastOk} />
          </div>

          <div className="space-y-4 relative min-h-[400px] max-h-[750px] overflow-y-auto pr-2 pb-4 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {news.state === "loading" && news.items.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
                <p className="text-sm font-medium">Memuat berita…</p>
              </div>
            ) : news.state === "error" && news.items.length === 0 ? (
              <PanelMessage
                icon={<WifiOff className="w-8 h-8" />}
                title="Berita tidak bisa dimuat"
                detail={news.detail}
                onRetry={news.reload}
              />
            ) : news.state === "empty" ? (
              <PanelMessage
                icon={<Inbox className="w-8 h-8" />}
                title="Belum ada berita"
                detail="Feed terhubung, tetapi belum ada item baru."
              />
            ) : (
              <>
                {news.state === "error" && (
                  <div className="text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2">
                    Pembaruan terakhir gagal. Menampilkan data sebelumnya.
                  </div>
                )}
                {news.items.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative flex flex-col sm:flex-row gap-4 p-4 bg-white border border-slate-200 dark:bg-[#09090b]/80 dark:border-zinc-800/80 rounded-xl transition-all duration-500 group hover:border-emerald-500/30 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/5 hover:shadow-[0_8px_30px_rgba(16,185,129,0.06)] overflow-hidden"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/70 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                    {item.image_url && (
                      <div className="sm:w-28 sm:h-24 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-zinc-800/50 relative">
                        <img
                          src={item.image_url}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                          }}
                        />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 relative z-10">
                      <div className="flex justify-between items-start gap-4 mb-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-zinc-500 tracking-wide uppercase group-hover:text-emerald-600 transition-colors duration-500">
                          {item.source}
                        </span>
                        {/* impact === null berarti belum diklasifikasi.
                            Ditampilkan apa adanya, tidak dipaksa jadi NEUTRAL. */}
                        {item.impact ? (
                          <span
                            title="Klasifikasi otomatis, bukan nasihat keuangan"
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded flex items-center shrink-0 gap-1 ${
                              item.impact === "BULLISH"
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500"
                                : item.impact === "BEARISH"
                                ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500"
                                : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500"
                            }`}
                          >
                            {item.impact === "BULLISH" && <TrendingUp className="w-3 h-3" />}
                            {item.impact === "BEARISH" && <TrendingDown className="w-3 h-3" />}
                            {item.impact === "IMPORTANT" && <AlertCircle className="w-3 h-3" />}
                            {item.impact}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded shrink-0 bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-500">
                            Belum dinilai
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-medium text-slate-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-700 dark:group-hover:text-emerald-400 flex items-start justify-between gap-4 transition-colors duration-500">
                        <span className="line-clamp-2">{item.title}</span>
                        <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500 shrink-0 mt-1 text-emerald-500/70" />
                      </h3>

                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-2">
                        {relativeTime(item.published_at)}
                      </p>
                    </div>
                  </a>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ---------------- KANAN: ON-CHAIN ---------------- */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> On-Chain Stream
            </h2>
            <FeedBadge state={chain.state} lastOk={chain.lastOk} />
          </div>

          <div className="space-y-3 relative min-h-[450px]">
            {chain.state === "loading" && chain.items.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-slate-50/80 dark:bg-[#09090b]/60 border border-slate-200 dark:border-zinc-800/80">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-500 mb-3" />
                <span className="text-slate-600 dark:text-zinc-400 text-xs font-medium tracking-wide">
                  Memuat aliran on-chain…
                </span>
              </div>
            ) : chain.state === "error" && chain.items.length === 0 ? (
              <PanelMessage
                icon={<WifiOff className="w-8 h-8" />}
                title="Aliran on-chain terputus"
                detail={chain.detail}
                onRetry={chain.reload}
              />
            ) : chain.state === "empty" ? (
              <PanelMessage
                icon={<Inbox className="w-8 h-8" />}
                title="Belum ada aktivitas"
                detail="Webhook terhubung, belum ada event masuk."
              />
            ) : (
              chain.items.map((item) => (
                <div
                  key={item.id}
                  className="relative p-4 bg-white border border-slate-200 dark:bg-[#09090b]/80 dark:border-zinc-800/80 rounded-xl hover:border-emerald-500/30 transition-all duration-300 group"
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      {item.event_type === "BLOCK" ? (
                        <Box className="w-4 h-4 text-slate-500 dark:text-zinc-500" />
                      ) : (
                        <Zap className={`w-4 h-4 ${item.status === "IMPORTANT" ? "text-amber-500" : "text-emerald-600 dark:text-emerald-500/80"}`} />
                      )}
                      <span className={`text-xs font-semibold uppercase tracking-wider ${item.status === "IMPORTANT" ? "text-amber-600 dark:text-amber-500" : "text-slate-600 dark:text-zinc-400"}`}>
                        {item.event_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-md">
                      <Clock className="w-3 h-3 text-slate-400 dark:text-zinc-500" />
                      <span className="text-[10px] font-mono text-slate-700 dark:text-zinc-300">
                        {relativeTime(item.received_at)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-end gap-2 mb-2">
                    <h4 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600 dark:from-emerald-400 dark:to-cyan-400">
                      {item.amount_display ?? "—"}
                    </h4>
                    <span className="text-sm font-bold text-slate-500 dark:text-zinc-400 mb-1">
                      {item.asset ?? ""}
                    </span>
                  </div>

                  {(item.from_address || item.to_address) && (
                    <div className="flex items-center justify-between mt-3 mb-2 text-[10px] font-mono w-full bg-slate-50 dark:bg-zinc-900/50 p-2 rounded-lg border border-slate-200 dark:border-zinc-800/50">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        <span className="text-slate-600 dark:text-zinc-400">
                          {shortAddress(item.from_address)}
                        </span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 opacity-50" />
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          {shortAddress(item.to_address)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800/50">
                    <p className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 truncate mr-2">
                      {item.network ?? "—"} · {shortAddress(item.tx_hash)}
                    </p>
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        item.status === "IMPORTANT"
                          ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse"
                          : "bg-emerald-500"
                      }`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}