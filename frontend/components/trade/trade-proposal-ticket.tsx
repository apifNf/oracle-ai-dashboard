"use client";

import { useEffect, useState } from "react";
import {
  Ticket, ArrowUp, ArrowDown, ShieldCheck, Loader2, AlertTriangle,
  CheckCircle2, X, Beaker, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ProposalParams, type TradeProposal, type TradeConfig, type TradeMode,
  fetchProposal, fetchTradeConfig, executeTrade,
} from "@/lib/trade";
import {
  useWorkspace, exchangeLabel, credentialsStatus, WORKSPACE_EVENT,
} from "@/lib/workspace";

type Props = {
  params: ProposalParams;
  /** Dipanggil setelah eksekusi sukses (mis. refresh journal). */
  onExecuted?: (result: any) => void;
};

const fmt = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

const fmtPrice = (v: number | null | undefined) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const d = v >= 100 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export function TradeProposalTicket({ params, onExecuted }: Props) {
  const ws = useWorkspace(); // Primary Exchange + Trading Environment dari Settings
  const exLabel = exchangeLabel(ws.exchange);

  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [config, setConfig] = useState<TradeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmMode, setConfirmMode] = useState<TradeMode | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // Kelengkapan kunci bursa user (SaaS publik / non-custodial). Dibaca dari
  // localStorage dan ikut berubah begitu Settings di-save — user tidak perlu
  // reload untuk melihat tombol Auto-Trade aktif.
  const [creds, setCreds] = useState<{ ready: boolean; missing: string[] }>({
    ready: false,
    missing: [],
  });
  useEffect(() => {
    const sync = () => setCreds(credentialsStatus(ws.exchange));
    sync();
    window.addEventListener(WORKSPACE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WORKSPACE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [ws.exchange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchProposal(params), fetchTradeConfig()])
      .then(([p, c]) => {
        if (!active) return;
        setProposal(p);
        setConfig(c);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Gagal memuat proposal"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  const runExecute = async (mode: TradeMode) => {
    setExecuting(true);
    setExecError(null);
    try {
      const res = await executeTrade({
        ...params,
        mode,
        confirm: true,
        dry_run: true, // UI selalu dry-run untuk LIVE; order nyata dikirim eksplisit lewat backend
        exchange_id: ws.exchange,
        market_type: ws.environment,
      });
      setResult({ ...res, _mode: mode });
      onExecuted?.(res);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Eksekusi gagal");
    } finally {
      setExecuting(false);
      setConfirmMode(null);
    }
  };

  const isLong = params.side === "BUY";

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-4 flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> Menyusun Trade Proposal Ticket…
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Proposal tidak bisa dibuat: {error ?? "data tidak lengkap"}.</span>
      </div>
    );
  }

  if (result) {
    const t = result.trade ?? {};
    const dry = t.status === "DRY_RUN";
    return (
      <div className="rounded-xl border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          {result._mode === "PAPER_TRADING"
            ? "Paper trade dieksekusi"
            : dry
            ? `LIVE dry-run ${exLabel} OK — order TIDAK dikirim`
            : `Order LIVE ${exLabel} terkirim`}
        </div>
        <p className="text-xs font-mono text-emerald-700/80 dark:text-emerald-300/70">
          {t.symbol} {t.side} · {t.position_size_coin} coin · margin ${fmt(t.allocated_margin_usdt)} ·
          {t.id ? ` id ${t.id}` : ""} · status {t.status}
        </p>
        {result.account && (
          <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70">
            Saldo virtual: ${fmt(result.account.balance_usdt)} · margin dipakai $
            {fmt(result.account.allocated_margin_usdt)} · posisi terbuka {result.account.open_positions}
          </p>
        )}
        <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/60 pt-1">
          Terhubung ke menu <strong>Journal / Trade Ledger</strong>.
        </p>
      </div>
    );
  }

  const liveEnabled = Boolean(config?.live_enabled);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40">
        <div className="flex items-center gap-2">
          <Ticket className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
          <span className="text-sm font-semibold text-slate-900 dark:text-white">Trade Proposal Ticket</span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border",
            isLong
              ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
              : "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
          )}
        >
          {isLong ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {proposal.symbol} · {isLong ? "BUY" : "SELL"}
        </span>
      </div>

      {/* Grid */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
        <Field label="Entry Price" value={`$${fmtPrice(proposal.entry_price)}`} mono />
        <Field label="Stop Loss" value={`$${fmtPrice(proposal.stop_loss_price)}`} mono tone="red" />
        <Field
          label="Take Profit"
          value={proposal.take_profit_targets.map((t) => `$${fmtPrice(t)}`).join("  ·  ")}
          mono
          tone="emerald"
        />
        <Field
          label="Risk / Reward"
          value={
            proposal.risk_reward_ratio.length
              ? proposal.risk_reward_ratio.map((r) => `${r.toFixed(2)}R`).join("  ·  ")
              : "—"
          }
          mono
        />
        <Field label="Est. Margin" value={`$${fmt(proposal.estimated_margin_usdt)}`} mono />
        <Field label="Leverage" value={`${proposal.applied_leverage}x`} mono />
        <Field label="Position Size" value={`${proposal.position_size_coin}`} mono />
        <Field label="Notional" value={`$${fmt(proposal.notional_usdt)}`} mono />
        <Field label="Risk" value={`${proposal.applied_risk_pct}% ($${fmt(proposal.risk_amount_usdt)})`} mono />
      </div>

      {/* Guardrail */}
      <div className="px-4 pb-3 -mt-1">
        <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-zinc-500">
          <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-500" />
          Guardrail: {proposal.guardrail_caps}
          {" · "}SL {proposal.sl_distance_pct}% dari entry
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 px-4 py-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/30">
        <button
          onClick={() => setConfirmMode("PAPER_TRADING")}
          disabled={executing}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          <Beaker className="w-4 h-4" /> Execute Paper Trade
        </button>
        <button
          onClick={() => setConfirmMode("LIVE")}
          disabled={executing || !liveEnabled}
          title={liveEnabled ? undefined : "LIVE dinonaktifkan (TRADE_LIVE_ENABLED=false)"}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Zap className="w-4 h-4" /> Execute {exLabel}
          <span className="text-[10px] font-normal opacity-70">
            {ws.environment === "futures" ? "· Futures" : "· Spot"}
            {config?.exchange_testnet && liveEnabled ? " · testnet" : ""}
          </span>
        </button>
      </div>

      {/* Kunci bursa user belum lengkap — beri tahu SEBELUM user menekan
          eksekusi, bukan setelah bursa menolak ordernya. */}
      {liveEnabled && !creds.ready && (
        <div className="flex items-start gap-2 px-4 pb-3 -mt-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-amber-500" />
          <p className="text-[11px] text-amber-700 dark:text-amber-400/90 leading-relaxed">
            Auto-Trade {exLabel} butuh {creds.missing.join(" + ")} Anda — lengkapi di{" "}
            <a href="/settings" className="underline underline-offset-2 hover:text-amber-600">
              Settings → Workspace Configuration
            </a>
            . Sampai itu terisi, tombol di atas hanya menjalankan dry-run.
          </p>
        </div>
      )}

      {execError && (
        <p className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">{execError}</p>
      )}

      {/* Confirm modal */}
      {confirmMode && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-zinc-800">
              <span className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                {confirmMode === "PAPER_TRADING" ? (
                  <Beaker className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Zap className="w-4 h-4 text-amber-500" />
                )}
                Konfirmasi {confirmMode === "PAPER_TRADING" ? "Paper Trade" : `LIVE ${exLabel} (${ws.environment === "futures" ? "Futures" : "Spot"})`}
              </span>
              <button onClick={() => setConfirmMode(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2 text-sm text-slate-700 dark:text-zinc-300">
              <p>
                <strong>{proposal.symbol}</strong> {isLong ? "BUY / LONG" : "SELL / SHORT"} ·{" "}
                {proposal.position_size_coin} coin · {proposal.applied_leverage}x
              </p>
              <p className="font-mono text-xs">
                Entry ${fmtPrice(proposal.entry_price)} · SL ${fmtPrice(proposal.stop_loss_price)} · TP{" "}
                {proposal.take_profit_targets.map((t) => `$${fmtPrice(t)}`).join(" / ")}
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                Est. margin ${fmt(proposal.estimated_margin_usdt)} · risk {proposal.applied_risk_pct}% · R/R{" "}
                {proposal.primary_rr ?? "—"}
              </p>
              {confirmMode === "LIVE" && (
                <>
                  <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-2">
                    Rute: <strong>{exLabel}</strong> · {ws.environment === "futures" ? "Perpetual Futures" : "Spot"}.
                    Dikirim sebagai <strong>dry-run</strong> dari UI ini (validasi CCXT tanpa order nyata).
                    Order sungguhan hanya jika backend TRADE_LIVE_ENABLED=true.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 flex items-start gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-500" />
                    {creds.ready ? (
                      <>
                        Order akan dikirim memakai <strong>kunci API {exLabel} Anda sendiri</strong>{" "}
                        (non-custodial). Kunci tidak disimpan di server.
                      </>
                    ) : (
                      <>
                        Belum ada {creds.missing.join(" + ")} tersimpan — eksekusi ini tetap
                        dry-run. Lengkapi di Settings untuk Auto-Trade sungguhan.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-slate-200 dark:border-zinc-800">
              <button
                onClick={() => setConfirmMode(null)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => runExecute(confirmMode)}
                disabled={executing}
                className={cn(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50",
                  confirmMode === "PAPER_TRADING"
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "bg-amber-600 hover:bg-amber-500",
                )}
              >
                {executing ? "Mengirim…" : "Konfirmasi & Kirim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "red" | "emerald";
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-medium text-slate-900 dark:text-zinc-100",
          mono && "font-mono",
          tone === "red" && "text-red-600 dark:text-red-400",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
