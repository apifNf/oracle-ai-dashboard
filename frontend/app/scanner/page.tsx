"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  TrendingDown, TrendingUp, Minus, Activity, Wifi, WifiOff, Loader2, Lock,
  AlertTriangle, Check, X, Clock, RefreshCw, ShieldAlert,
} from "lucide-react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";

/* ================================================================== */
/* Tipe — cocok persis dengan payload ScannerHub.build_snapshot()      */
/* ================================================================== */

type AssetStatus =
  | "ok" | "stale" | "pending" | "unavailable"
  | "insufficient_history" | "blocked_by_market_status" | "unknown_symbol";

type Signal = {
  coin: string;
  pair: string;
  price: number | null;
  change_24h: number | null;
  price_status: string;
  price_age_seconds: number | null;
  status: AssetStatus;
  signal: "LONG" | "SHORT" | "WAIT" | null;
  trend: string | null;
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  indicator_interval?: string | null;
  indicator_source?: string | null;
  last_closed_at?: string | null;
  criteria_met: string[];
  criteria_total: number;
  rule_set: string;
  error: { code: string; message: string } | null;
};

type Snapshot = {
  status: "ok" | "degraded" | "starting";
  generated_at: string;
  stream: {
    connected: boolean;
    pairs_tracked: number;
    pairs_fresh: number;
    consecutive_failures: number;
    connected_since: string | null;
  };
  indicators_age_seconds: number | null;
  counts: { total: number; ok: number; degraded: number };
  disclaimer: string;
  signals: Signal[];
};

type Candle = { time: number; open: number; high: number; low: number; close: number };

type DetailPayload = {
  symbol: string;
  status: string;
  interval: string;
  source: string | null;
  price: number | null;
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  trend: string | null;
  candles_used: number;
  last_closed_at: string | null;
  chartData: Candle[];
  live_price?: number | null;
  error: { code: string; message: string } | null;
};

type SocketState = "connecting" | "connected" | "reconnecting" | "disconnected";

/* ================================================================== */
/* Konstanta                                                           */
/* ================================================================== */

const HTTP_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const WS_ENDPOINT = `${HTTP_BASE.replace(/^http/, "ws")}/api/v1/ws/scanner`;
const DETAIL_ENDPOINT = `${HTTP_BASE}/api/v1/scanner/detail`;

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const SNAPSHOT_STALE_MS = 20_000;

/** Label kriteria — sengaja verbatim aturannya, supaya bisa diaudit user. */
const CRITERIA_LABELS: Record<string, string> = {
  ema20_above_ema50: "EMA20 di atas EMA50",
  ema20_below_ema50: "EMA20 di bawah EMA50",
  rsi_below_overbought: "RSI di bawah 70",
  rsi_above_oversold: "RSI di atas 30",
  rsi_above_midline: "RSI di atas 50",
  rsi_below_midline: "RSI di bawah 50",
};

const BULLISH_CRITERIA = ["ema20_above_ema50", "rsi_below_overbought", "rsi_above_midline"];
const BEARISH_CRITERIA = ["ema20_below_ema50", "rsi_above_oversold", "rsi_below_midline"];

const STATUS_COPY: Record<AssetStatus, { label: string; detail: string }> = {
  ok: { label: "Terkini", detail: "" },
  stale: { label: "Tertunda", detail: "Harga terakhir sudah lewat beberapa saat." },
  pending: { label: "Menunggu", detail: "Indikator belum selesai dihitung." },
  unavailable: { label: "Tidak tersedia", detail: "Data harga belum bisa diambil." },
  insufficient_history: { label: "Riwayat kurang", detail: "Candle belum cukup untuk indikator yang konvergen." },
  blocked_by_market_status: { label: "Dihentikan", detail: "Perhitungan dibatalkan karena data harga bermasalah." },
  unknown_symbol: { label: "Tidak dikenal", detail: "Aset tidak ada dalam daftar." },
};

/* ================================================================== */
/* Helper                                                              */
/* ================================================================== */

const fmt = (value: number | null | undefined, digits = 2): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";

const fmtPrice = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const ageText = (seconds: number | null): string => {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} dtk lalu`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} mnt lalu`;
  return `${Math.floor(mins / 60)} jam lalu`;
};

/* ================================================================== */
/* Disclaimer — statis, selalu terlihat, tidak bisa ditutup            */
/* ================================================================== */

function RiskDisclaimer({ text }: { text?: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20 p-4 sm:p-5">
      <div className="flex gap-3">
        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-400">
            Peringatan Risiko — Bukan Nasihat Keuangan
          </p>
          <p className="text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/80">
            Sinyal di halaman ini dihasilkan aturan teknikal deterministik yang{" "}
            <strong>belum diuji terhadap data historis</strong>. Tidak ada probabilitas
            terkalibrasi, tidak ada jaminan akurasi, dan tidak ada proyeksi keuntungan.
            Perdagangan aset kripto berisiko tinggi dan dapat mengakibatkan kehilangan
            seluruh modal. Keputusan transaksi sepenuhnya menjadi tanggung jawab Anda.
            ORACLE tidak memberikan rekomendasi investasi.
          </p>
          {text && (
            <p className="text-[11px] font-mono text-amber-700/70 dark:text-amber-400/60 pt-1 border-t border-amber-200 dark:border-amber-900/50">
              {text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Kriteria — pengganti "confidence"                                   */
/* ================================================================== */

function CriteriaList({ met, total }: { met: string[]; total: number }) {
  // Tampilkan hanya kriteria dari arah yang relevan, supaya user melihat
  // "2 dari 3 syarat bullish" dan bukan daftar enam syarat bercampur.
  const family = met.some((m) => BULLISH_CRITERIA.includes(m))
    ? BULLISH_CRITERIA
    : met.some((m) => BEARISH_CRITERIA.includes(m))
    ? BEARISH_CRITERIA
    : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500 dark:text-zinc-400 font-medium">Kriteria terpenuhi</span>
        <span className="font-mono font-semibold text-slate-900 dark:text-zinc-100">
          {met.length} / {total}
        </span>
      </div>

      {family.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {family.map((key) => {
            const isMet = met.includes(key);
            return (
              <span
                key={key}
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border",
                  isMet
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                    : "bg-slate-50 text-slate-400 border-slate-200 dark:bg-zinc-900 dark:text-zinc-600 dark:border-zinc-800",
                )}
              >
                {isMet ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                {CRITERIA_LABELS[key] ?? key}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 dark:text-zinc-600">
          Tidak ada kriteria arah yang terpenuhi.
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/* Badge status per aset                                               */
/* ================================================================== */

function StatusPill({ status, ageSeconds }: { status: AssetStatus; ageSeconds: number | null }) {
  if (status === "ok") return null;

  const copy = STATUS_COPY[status] ?? STATUS_COPY.unavailable;
  const tone =
    status === "stale" || status === "pending"
      ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
      : "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20";

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border", tone)}>
      <AlertTriangle className="w-3 h-3" />
      {copy.label}
      {status === "stale" && ageSeconds !== null && ` · ${ageText(ageSeconds)}`}
    </span>
  );
}

/* ================================================================== */
/* Chart detail — hanya dimuat saat kartu dibuka                       */
/* ================================================================== */

function DetailChart({ coin, isDark }: { coin: string; isDark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  const [interval, setIntervalValue] = useState<string>("1h");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 220,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#71717a" : "#64748b",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(39,39,42,0.4)" : "#e2e8f0" },
        horzLines: { color: isDark ? "rgba(39,39,42,0.4)" : "#e2e8f0" },
      },
      timeScale: { timeVisible: true, borderColor: isDark ? "#27272a" : "#e2e8f0" },
      rightPriceScale: { borderColor: isDark ? "#27272a" : "#e2e8f0" },
      handleScroll: false,
      handleScale: false,
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isDark]);

  // Fetch per aset + interval. Inilah yang menggantikan pengiriman
  // 4 timeframe x 30 aset di setiap broadcast.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${DETAIL_ENDPOINT}/${coin}?interval=${interval}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: DetailPayload = await res.json();
        if (!active) return;
        if (!body || !Array.isArray(body.chartData)) {
          throw new Error("Bentuk respons tidak dikenali");
        }
        setDetail(body);
      } catch (err) {
        if (controller.signal.aborted || !active) return;
        console.error(`[scanner] detail ${coin} gagal:`, err);
        setError(err instanceof Error ? err.message : "Gagal memuat detail");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [coin, interval]);

  useEffect(() => {
    if (!seriesRef.current || !detail) return;
    if (detail.status !== "ok" || detail.chartData.length === 0) {
      seriesRef.current.setData([]);
      return;
    }
    seriesRef.current.setData(detail.chartData);
    chartRef.current?.timeScale().fitContent();
  }, [detail]);

  const unusable = Boolean(detail && detail.status !== "ok");

  return (
    <div className="mt-4 space-y-2 border-t border-slate-100 dark:border-zinc-800/50 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
          Price Action
          {detail?.source && (
            <span className="ml-1.5 normal-case tracking-normal text-slate-400 dark:text-zinc-600">
              · {detail.source}
            </span>
          )}
        </span>
        <div className="flex gap-1 p-0.5 bg-slate-100 dark:bg-zinc-900 rounded-md border border-slate-200 dark:border-zinc-800/80">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              onClick={(e) => { e.stopPropagation(); setIntervalValue(tf); }}
              className={cn(
                "px-2 py-0.5 text-[10px] font-bold rounded-sm transition-all uppercase",
                interval === tf
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300",
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 dark:border-zinc-800/50 dark:bg-[#00000020]"
        />

        {(loading || error || unusable) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/85 dark:bg-black/70 backdrop-blur-[2px] text-center px-4">
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span className="text-xs text-slate-500 dark:text-zinc-400">Memuat candle…</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Candle tidak bisa ditampilkan
                </span>
                <span className="text-[11px] text-slate-500 dark:text-zinc-500 max-w-[240px]">
                  {error ?? detail?.error?.message ?? "Data tidak memadai."}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {detail?.status === "ok" && detail.last_closed_at && (
        <p className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono">
          Candle terakhir ditutup {new Date(detail.last_closed_at).toLocaleString("id-ID")} ·{" "}
          {detail.candles_used} candle dipakai
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/* Halaman                                                             */
/* ================================================================== */

export default function ScannerPage() {
  const { resolvedTheme } = useTheme();
  const { tier } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => setMounted(true), []);
  const isDark = mounted ? resolvedTheme === "dark" : true;

  /* ---------------- WebSocket dengan auto-reconnect ---------------- */

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (closedByUs.current) return;
    retryRef.current += 1;
    // Exponential backoff dengan jitter, dibatasi RECONNECT_MAX_MS.
    const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** retryRef.current, RECONNECT_MAX_MS);
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    timerRef.current = setTimeout(() => connectRef.current(), delay);
  }, []);

  const connect = useCallback(() => {
    if (closedByUs.current) return;
    setSocketState(retryRef.current === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_ENDPOINT);
    } catch (err) {
      console.error("[scanner] gagal membuka WebSocket:", err);
      scheduleReconnect();
      return;
    }
    wsRef.current = socket;

    socket.onopen = () => {
      retryRef.current = 0;
      setSocketState("connected");
    };

    socket.onmessage = (event) => {
      try {
        const body: Snapshot = JSON.parse(event.data);
        if (!body || !Array.isArray(body.signals)) {
          throw new Error("Bentuk snapshot tidak dikenali");
        }
        setSnapshot(body);
        setLastMessageAt(Date.now());
      } catch (err) {
        // Dicatat, dan karena lastMessageAt tidak diperbarui, badge akan
        // berubah menjadi "Data tertunda" sendiri. Tidak ada kegagalan diam.
        console.error("[scanner] payload tidak valid:", err);
      }
    };

    socket.onclose = () => {
      wsRef.current = null;
      if (closedByUs.current) return;
      setSocketState("reconnecting");
      scheduleReconnect();
    };
  }, [scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    closedByUs.current = false;
    connect();
    return () => {
      closedByUs.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const reconnectNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    retryRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    connect();
  };

  /* ---------------- Deteksi snapshot macet ---------------- */

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  const snapshotStale = useMemo(
    () => lastMessageAt !== null && now - lastMessageAt > SNAPSHOT_STALE_MS,
    [lastMessageAt, now],
  );

  const signals = snapshot?.signals ?? [];
  const isInitialLoading = snapshot === null && socketState !== "disconnected";

  if (!mounted) return null;

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400">
            Scanner
          </p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            <Activity className="w-8 h-8 text-emerald-500" /> Live Signal Scanner
          </h1>
          {snapshot && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-500 font-mono">
              {snapshot.counts.ok}/{snapshot.counts.total} aset dengan data lengkap
              {snapshot.signals[0]?.rule_set && ` · aturan ${snapshot.signals[0].rule_set}`}
              {snapshot.indicators_age_seconds !== null &&
                ` · indikator ${ageText(snapshot.indicators_age_seconds)}`}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          {(socketState !== "connected" || snapshotStale) && (
            <button
              onClick={reconnectNow}
              className="flex items-center gap-2 px-4 py-2 border rounded-lg font-medium text-sm bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-[#09090b] dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Sambungkan ulang
            </button>
          )}

          <div
            className={cn(
              "flex items-center gap-2 px-4 py-2 border rounded-lg font-medium shadow-sm dark:shadow-none",
              socketState === "connected" && !snapshotStale
                ? "bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-500"
                : socketState === "connected" && snapshotStale
                ? "bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-500"
                : "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-500",
            )}
          >
            {socketState === "connected" && !snapshotStale ? (
              <><Wifi className="w-4 h-4" /><span className="text-sm">Live Stream</span></>
            ) : socketState === "connected" && snapshotStale ? (
              <><Clock className="w-4 h-4" /><span className="text-sm">Data tertunda</span></>
            ) : socketState === "reconnecting" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Menyambung ulang…</span></>
            ) : socketState === "connecting" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Menyambung…</span></>
            ) : (
              <><WifiOff className="w-4 h-4" /><span className="text-sm">Terputus</span></>
            )}
          </div>
        </div>
      </div>

      {/* Disclaimer — statis, tidak bisa ditutup */}
      <RiskDisclaimer text={snapshot?.disclaimer} />

      {/* Peringatan koneksi bursa */}
      {snapshot && !snapshot.stream.connected && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-4 flex gap-3">
          <WifiOff className="w-5 h-5 shrink-0 text-red-600 dark:text-red-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-900 dark:text-red-400">
              Aliran harga bursa terputus
            </p>
            <p className="text-xs text-red-800/90 dark:text-red-300/80 mt-1">
              Server sedang menyambung ulang ({snapshot.stream.consecutive_failures} percobaan).
              Angka di bawah adalah data terakhir yang diterima, bukan harga saat ini.
            </p>
          </div>
        </div>
      )}

      {/* Konten */}
      {isInitialLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl p-5 animate-pulse space-y-4">
              <div className="flex justify-between items-center pb-2">
                <div className="h-6 w-24 bg-slate-200 dark:bg-zinc-800 rounded" />
                <div className="h-6 w-16 bg-slate-200 dark:bg-zinc-800 rounded" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-100 dark:bg-zinc-800/60 rounded" />
                <div className="h-4 w-full bg-slate-100 dark:bg-zinc-800/60 rounded" />
                <div className="h-4 w-2/3 bg-slate-100 dark:bg-zinc-800/60 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : signals.length === 0 ? (
        <div className="p-12 border border-dashed border-slate-300 bg-slate-50 dark:border-zinc-800 dark:bg-transparent rounded-xl text-slate-500 dark:text-zinc-500 text-center flex flex-col items-center">
          <WifiOff className="w-12 h-12 mb-4 opacity-30" />
          <p className="font-medium text-slate-700 dark:text-zinc-300">Tidak ada data scanner</p>
          <p className="text-sm mt-1">
            {socketState === "connected"
              ? "Server terhubung tetapi belum mengirim aset apa pun."
              : "Koneksi ke server terputus."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((item, index) => {
            const isLocked = tier !== "pro" && index >= 3;
            const isOpen = expanded === item.coin;
            const usable = item.status === "ok" || item.status === "stale";

            return (
              <div
                key={item.pair}
                onClick={() => !isLocked && usable && setExpanded(isOpen ? null : item.coin)}
                className={cn(
                  "group relative border rounded-xl p-5 transition-all duration-300 overflow-hidden",
                  "border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]",
                  !isLocked && usable && "cursor-pointer hover:border-slate-300 dark:hover:border-zinc-700 hover:shadow-md",
                  !usable && "opacity-75",
                  isOpen && "ring-1 ring-emerald-500/30",
                )}
              >
                <div className={cn("transition-all duration-500", isLocked && "blur-[6px] select-none opacity-50")}>
                  {/* Judul + harga + sinyal */}
                  <div className="flex justify-between items-start gap-2 mb-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {item.coin}{" "}
                        <span className="text-sm font-medium text-slate-400 dark:text-zinc-500">/ USDT</span>
                      </h2>
                      <p className="mt-1 font-mono text-sm text-slate-600 dark:text-zinc-400">
                        {fmtPrice(item.price)}
                        {typeof item.change_24h === "number" && (
                          <span className={cn(
                            "ml-2 text-xs font-semibold",
                            item.change_24h >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500",
                          )}>
                            {item.change_24h >= 0 ? "+" : ""}{fmt(item.change_24h)}%
                          </span>
                        )}
                      </p>
                    </div>

                    {item.signal ? (
                      <span
                        className={cn(
                          "px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider border shrink-0",
                          item.signal === "LONG"
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-500 dark:border-emerald-500/20"
                            : item.signal === "SHORT"
                            ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20"
                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/20",
                        )}
                      >
                        {item.signal}
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider border bg-slate-100 text-slate-500 border-slate-200 dark:bg-zinc-900 dark:text-zinc-500 dark:border-zinc-800 shrink-0">
                        Tidak ada sinyal
                      </span>
                    )}
                  </div>

                  {/* Status non-ok ditampilkan terbuka, bukan disembunyikan */}
                  {item.status !== "ok" && (
                    <div className="mb-4 space-y-1.5">
                      <StatusPill status={item.status} ageSeconds={item.price_age_seconds} />
                      <p className="text-[11px] text-slate-500 dark:text-zinc-500 leading-relaxed">
                        {item.error?.message ?? STATUS_COPY[item.status]?.detail}
                      </p>
                    </div>
                  )}

                  {usable ? (
                    <div className="space-y-3">
                      <CriteriaList met={item.criteria_met} total={item.criteria_total} />

                      <div className="flex justify-between items-center text-sm border-t border-slate-100 dark:border-zinc-800/50 pt-3">
                        <span className="text-slate-500 dark:text-zinc-400 font-medium">RSI (14)</span>
                        <span className={cn(
                          "font-mono font-medium",
                          item.rsi !== null && item.rsi > 70 ? "text-red-600 dark:text-red-400"
                            : item.rsi !== null && item.rsi < 30 ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-700 dark:text-zinc-300",
                        )}>
                          {fmt(item.rsi)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500 dark:text-zinc-400 font-medium">EMA 20 / 50</span>
                        <span className="font-mono text-slate-700 dark:text-zinc-300 font-medium">
                          {fmt(item.ema20)} <span className="text-slate-300 dark:text-zinc-600">/</span> {fmt(item.ema50)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500 dark:text-zinc-400 font-medium">Tren</span>
                        <div className="flex items-center gap-1.5 font-medium">
                          {item.trend?.toLowerCase() === "bullish" ? (
                            <><TrendingUp className="w-4 h-4 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-500">Bullish</span></>
                          ) : item.trend?.toLowerCase() === "bearish" ? (
                            <><TrendingDown className="w-4 h-4 text-red-500" /><span className="text-red-600 dark:text-red-500">Bearish</span></>
                          ) : (
                            <><Minus className="w-4 h-4 text-slate-400 dark:text-zinc-500" /><span className="text-slate-500 dark:text-zinc-400">—</span></>
                          )}
                        </div>
                      </div>

                      {!isOpen && (
                        <p className="text-[10px] text-slate-400 dark:text-zinc-600 pt-1">
                          Klik kartu untuk melihat candle
                        </p>
                      )}

                      {isOpen && !isLocked && <DetailChart coin={item.coin} isDark={isDark} />}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-zinc-600 border-t border-slate-100 dark:border-zinc-800/50 pt-3">
                      Indikator tidak dihitung untuk aset ini. Tidak ada angka yang
                      ditampilkan agar tidak menyesatkan.
                    </p>
                  )}
                </div>

                {isLocked && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/20 dark:bg-black/40 hover:bg-emerald-500/5 transition-all duration-500 cursor-pointer">
                    <div className="p-3 bg-white dark:bg-[#0A0A0A] rounded-full shadow-xl mb-3 border border-slate-200 dark:border-white/10 group-hover:border-emerald-500/40 transition-colors duration-500">
                      <Lock className="w-5 h-5 text-slate-400 dark:text-zinc-500 group-hover:text-emerald-500 transition-colors duration-500" />
                    </div>
                    <span className="text-sm font-bold tracking-widest text-slate-900 dark:text-white uppercase">
                      Pro Alpha Signal
                    </span>
                    <span className="text-xs font-medium text-slate-500 dark:text-zinc-400 mt-1">
                      Upgrade to unlock
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}