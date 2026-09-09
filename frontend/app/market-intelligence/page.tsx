"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe, ExternalLink, Lock, Loader2, Radio, CalendarClock,
  TrendingUp, TrendingDown, Minus, Zap,
} from "lucide-react";
import { useAccountId, fetchBillingStatus } from "@/lib/billing";
import { UpgradeToProModal } from "@/components/billing/upgrade-to-pro-modal";
import { EconomicCalendar } from "@/components/market-intel/economic-calendar";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";

const API_ROOT = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api/v1/market-intel`;

type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  image_url: string | null;
  published_at: string;
  impact: string | null;
  sentiment?: Sentiment;
  fresh?: boolean;
};

type OnChainItem = {
  id: string;
  event_type?: string;
  asset: string | null;
  amount_display: string | null;
  amount_usd?: number | null;
  side?: string;
  from_address: string | null;
  to_address: string | null;
  status: string;
  received_at: string;
  ticker_line?: string;
  ticker_sub?: string;
};

type Envelope<T> = {
  status: "ok" | "empty" | "degraded";
  data: T[];
  count: number;
  as_of: string;
  tier: "free" | "pro";
  locked: boolean;
  error: { code: string; message: string } | null;
};

/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "Baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

function SentimentChip({ s }: { s: Sentiment }) {
  const map = {
    BULLISH: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    BEARISH: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25",
    NEUTRAL: "bg-slate-500/10 text-slate-500 dark:text-zinc-400 border-slate-500/25",
  } as const;
  const Icon = s === "BULLISH" ? TrendingUp : s === "BEARISH" ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border", map[s])}>
      <Icon className="w-3 h-3" />
      {s}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Data hook                                                           */
/* ------------------------------------------------------------------ */

function useFeed<T>(path: string, intervalMs: number, accountId: string) {
  const [items, setItems] = useState<T[]>([]);
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [locked, setLocked] = useState(true);
  const [state, setState] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const mounted = useRef(true);

  const load = useCallback(
    async (initial: boolean) => {
      if (initial) setState("loading");
      try {
        const res = await fetch(
          `${API_BASE}${path}?user_id=${encodeURIComponent(accountId)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: Envelope<T> = await res.json();
        if (!mounted.current || !Array.isArray(body.data)) return;
        setTier(body.tier);
        setLocked(body.locked);
        if (body.status === "degraded") {
          setState("error");
          return;
        }
        setItems(body.data);
        setState(body.data.length ? "ok" : "empty");
      } catch {
        if (mounted.current) setState("error");
      }
    },
    [path, accountId],
  );

  useEffect(() => {
    mounted.current = true;
    void load(true);
    const t = setInterval(() => void load(false), intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [load, intervalMs]);

  return { items, tier, locked, state, reload: () => void load(true) };
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export default function MarketIntelligencePage() {
  const t = useTranslation();
  const { accountId, ready } = useAccountId();
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    fetchBillingStatus(accountId).then((s) => s && setTier(s.tier));
    const t = setInterval(
      () => fetchBillingStatus(accountId).then((s) => s && setTier(s.tier)),
      15_000,
    );
    return () => clearInterval(t);
  }, [accountId, ready]);

  const news = useFeed<NewsItem>("/news", 45_000, accountId);
  const chain = useFeed<OnChainItem>("/onchain", 12_000, accountId);

  const isPro = tier === "pro" || news.tier === "pro" || chain.tier === "pro";

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400">
            {t("intel.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            <Globe className="w-8 h-8 text-emerald-500" />
            {isPro ? t("intel.title.pro") : t("intel.title.free")}
          </h1>
        </div>
        {isPro && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("intel.liveFeed")}
          </span>
        )}
      </div>

      {isPro ? (
        <AnalyticalTerminal news={news.items} chain={chain.items} loading={news.state === "loading"} />
      ) : (
        <PaywallView
          news={news.items}
          chain={chain.items}
          loading={news.state === "loading"}
          onUpgrade={() => setUpgradeOpen(true)}
        />
      )}

      <UpgradeToProModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        accountId={accountId}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PRO — Analytical Terminal                                           */
/* ------------------------------------------------------------------ */

function AnalyticalTerminal({
  news,
  chain,
  loading,
}: {
  news: NewsItem[];
  chain: OnChainItem[];
  loading: boolean;
}) {
  const t = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Alpha / Macro news — dengan thumbnail */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1015]/70 backdrop-blur-md shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-300">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-white/10">
            <Zap className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("intel.alphaNews")}</h2>
            <span className="ml-auto text-[10px] font-mono text-zinc-500">{news.length} headline · CryptoCompare / RSS live</span>
          </div>
          <div className="max-h-[560px] lg:max-h-[calc(100vh-24rem)] overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
            {loading && news.length === 0 ? (
              <div className="p-8 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : news.length === 0 ? (
              <p className="p-6 text-sm text-zinc-500">{t("intel.noHeadlines")}</p>
            ) : (
              news.map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-4 py-3 transition-colors group hover:bg-gradient-to-r hover:from-emerald-50 hover:to-transparent dark:hover:from-emerald-900/20 dark:hover:to-transparent"
                >
                  {n.image_url ? (
                    <img
                      src={n.image_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                      className="w-16 h-16 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg shrink-0 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] flex items-center justify-center">
                      <Globe className="w-5 h-5 text-slate-300 dark:text-zinc-700" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <SentimentChip s={(n.sentiment as Sentiment) ?? "NEUTRAL"} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 truncate">{n.source}</span>
                      <span className="ml-auto text-[10px] font-mono text-slate-400 dark:text-zinc-500 shrink-0">{relativeTime(n.published_at)}</span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-zinc-200 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors line-clamp-2">
                      {n.title}
                      <ExternalLink className="inline w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 text-emerald-400" />
                    </p>
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        {/* On-Chain Stream — HARDCORE TERMINAL */}
        <div className="lg:col-span-1 rounded-2xl border border-emerald-500/20 dark:border-emerald-500/15 bg-white dark:bg-black/90 shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-300">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-emerald-500/20 dark:border-emerald-500/15 bg-slate-50 dark:bg-black">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <h2 className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide">{t("intel.onchainStream")}</h2>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_#10b981]" />
          </div>
          <div className="max-h-[560px] lg:max-h-[calc(100vh-24rem)] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed bg-white dark:bg-black/90">
            {chain.length === 0 ? (
              <p className="p-3 text-emerald-600 dark:text-emerald-700 animate-pulse">
                {t("intel.awaitingWhale")}<span className="animate-ping">_</span>
              </p>
            ) : (
              chain.map((c) => {
                const alert = String(c.status).toUpperCase() === "IMPORTANT";
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "px-2 py-1 rounded",
                      alert
                        ? "text-amber-600 dark:text-amber-300 dark:[text-shadow:0_0_8px_rgba(245,158,11,0.35)]"
                        : "text-emerald-700 dark:text-emerald-400/90",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-slate-400 dark:text-zinc-600 shrink-0">[LIVE]</span>
                      <span className="flex-1 break-words">{c.ticker_line}</span>
                      <span className="text-slate-400 dark:text-zinc-700 shrink-0">{relativeTime(c.received_at)}</span>
                    </div>
                    {c.ticker_sub && (
                      <div className="pl-[3.2rem] text-slate-400 dark:text-zinc-600 break-all">{c.ticker_sub}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Macro & Government Events — TradingView Economic Calendar (forced dark) */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1015] shadow-sm dark:shadow-xl overflow-hidden transition-colors duration-300">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/70 backdrop-blur-md">
          <CalendarClock className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("intel.macroEvents")}</h2>
          <span className="ml-auto text-[10px] text-slate-400 dark:text-zinc-500">{t("intel.macroSub")}</span>
        </div>
        <div className="h-[460px] bg-white dark:bg-[#131722] transition-colors duration-300">
          <EconomicCalendar />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FREE — Glassmorphic Blur Paywall                                    */
/* ------------------------------------------------------------------ */

function PaywallView({
  news,
  chain,
  loading,
  onUpgrade,
}: {
  news: NewsItem[];
  chain: OnChainItem[];
  loading: boolean;
  onUpgrade: () => void;
}) {
  const t = useTranslation();
  const teaser = news.slice(0, 1);
  const blurredNews = news.slice(1);

  return (
    <div className="space-y-4">
      {/* Preview kecil — data lama, tajam */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
          <Globe className="w-4 h-4" /> {t("intel.alphaNews")} <span className="text-[10px] text-slate-400 dark:text-zinc-500">{t("intel.preview")}</span>
        </h2>
        {loading && teaser.length === 0 ? (
          <div className="p-6 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
        ) : (
          teaser.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-4 transition-colors hover:border-emerald-500/40 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-transparent dark:hover:from-emerald-900/20 dark:hover:to-transparent"
            >
              {n.image_url && (
                <img
                  src={n.image_url}
                  alt=""
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  className="w-16 h-16 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-white/10"
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <SentimentChip s={(n.sentiment as Sentiment) ?? "NEUTRAL"} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 truncate">{n.source}</span>
                  <span className="ml-auto text-[10px] text-zinc-500 shrink-0">{relativeTime(n.published_at)}</span>
                </div>
                <p className="text-sm text-slate-800 dark:text-zinc-200">{n.title}</p>
              </div>
            </a>
          ))
        )}
      </div>

      {/* Region terkunci — blur tebal + paywall */}
      <div className="relative rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden min-h-[420px]">
        <div className="blur-[7px] opacity-50 pointer-events-none select-none p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {(blurredNews.length ? blurredNews : news).map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/60 p-4">
              <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-zinc-500 mb-1">{n.source}</p>
              <p className="text-sm text-slate-600 dark:text-zinc-300">{n.title}</p>
            </div>
          ))}
          {chain.map((c) => (
            <div key={c.id} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] dark:bg-amber-500/[0.04] p-4 font-mono text-xs text-amber-600 dark:text-amber-300">
              🚨 {c.amount_display} {c.asset} · whale flow on-chain
            </div>
          ))}
          {news.length === 0 && (
            <>
              <div className="h-24 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/60" />
              <div className="h-24 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/60" />
              <div className="h-24 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/60" />
              <div className="h-24 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0e1015]/60" />
            </>
          )}
        </div>

        {/* Overlay lock card — sengaja glassmorphism gelap di kedua tema:
            kontras terhadap konten blur di belakangnya, bukan warna halaman. */}
        <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/55 backdrop-blur-md flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-[#0e1015]/85 backdrop-blur-xl p-6 shadow-2xl">
            <div className="mx-auto mb-3 w-11 h-11 rounded-full bg-amber-500/10 border border-amber-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.35)]">
              <Lock className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-base font-semibold text-white">
              {t("intel.paywall.title")}
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              {t("intel.paywall.body")}
            </p>
            <button
              onClick={onUpgrade}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 hover:from-emerald-400 hover:to-amber-400 py-2.5 px-4 font-semibold text-black shadow-lg transition"
            >
              <Lock className="w-4 h-4" /> {t("intel.paywall.cta")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
