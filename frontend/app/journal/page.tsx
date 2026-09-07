"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { NotebookPen, Plus, ArrowUpRight, ArrowDownRight, X, FileText, Edit2, Trash2, RefreshCw, Beaker, Zap, Loader2, Wallet } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { fetchJournal, fetchAccount, fetchLivePrices, type TradeRecord } from "@/lib/trade";
import { CloseTradeModal } from "@/components/journal/close-trade-modal";
import { GlassModal } from "@/components/ui/glass-modal";
import { useToasts, ToastViewport } from "@/components/ui/toast";

const PRICE_POLL_MS = 3000;
const LEDGER_POLL_MS = 12000;

const entryOf = (t: TradeRecord) => t.filled_price ?? t.entry_price;

/** Unrealized PnL untuk posisi OPEN pada harga live. */
function floatingPnl(t: TradeRecord, cur: number | undefined): number | null {
  if (t.status !== "OPEN" || typeof cur !== "number" || !Number.isFinite(cur)) return null;
  const entry = entryOf(t);
  const size = t.position_size_coin;
  return t.side === "BUY" ? (cur - entry) * size : (entry - cur) * size;
}

/** Return on Equity (margin) dalam %. */
const roePct = (t: TradeRecord, pnl: number | null): number | null =>
  pnl === null || !t.allocated_margin_usdt ? null : (pnl / t.allocated_margin_usdt) * 100;

type Trade = { id: number; pair: string; type: string; pnl: string; date: string; notes: string; };

const money = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

export default function JournalPage() {
  const { user } = useAuth();
  const accountId = user?.email || "default";

  const [mounted, setMounted] = useState(false);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // --- Executed trades dari ORACLE Trade Engine (Tugas 2) --- #
  const [execTrades, setExecTrades] = useState<TradeRecord[]>([]);
  const [execAccount, setExecAccount] = useState<any>(null);
  const [execLoading, setExecLoading] = useState(true);   // hanya untuk load pertama
  const [refreshing, setRefreshing] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [priceTick, setPriceTick] = useState(0);
  const [closeTarget, setCloseTarget] = useState<TradeRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const loadEngine = useCallback(async () => {
    setRefreshing(true);
    try {
      const [j, a] = await Promise.all([fetchJournal(accountId, 100), fetchAccount(accountId)]);
      // Anti-glitch: hanya perbarui state kalau data valid — jangan reset ke
      // kosong / null saat fetch gagal / parsial (bikin angka kedip ke 0).
      if (Array.isArray(j?.trades)) setExecTrades(j.trades);
      if (a?.account) setExecAccount(a.account);
    } catch (e) {
      console.error("Gagal memuat Trade Ledger:", e);
    } finally {
      setExecLoading(false);
      setRefreshing(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadEngine();
    const t = setInterval(loadEngine, LEDGER_POLL_MS);
    return () => clearInterval(t);
  }, [loadEngine]);

  // Simbol dengan posisi OPEN yang perlu harga live.
  const openSymbols = useMemo(
    () =>
      Array.from(
        new Set(execTrades.filter((t) => t.status === "OPEN").map((t) => t.symbol)),
      ),
    [execTrades],
  );
  const openSymbolsKey = openSymbols.join(",");

  // Polling harga live Binance tiap 3 detik untuk floating PnL real-time.
  useEffect(() => {
    if (!openSymbolsKey) {
      setLivePrices({});
      return;
    }
    let active = true;
    const poll = async () => {
      const p = await fetchLivePrices(openSymbolsKey.split(","));
      if (active && p && Object.keys(p).length) {
        setLivePrices(p);
        setPriceTick((n) => n + 1);
      }
    };
    poll();
    const t = setInterval(poll, PRICE_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [openSymbolsKey]);

  // Agregat floating PnL + Total Equity (net worth), live.
  const { totalFloating, totalEquity } = useMemo(() => {
    const tf = execTrades.reduce((sum, t) => {
      const pnl = floatingPnl(t, livePrices[t.symbol]);
      return sum + (pnl ?? 0);
    }, 0);
    const bal = execAccount?.balance_usdt ?? 0;
    return { totalFloating: tf, totalEquity: bal + tf };
    // priceTick memaksa recompute tiap poll walau referensi livePrices sama isinya
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execTrades, execAccount, livePrices, priceTick]);

  // Hasil dari CloseTradeModal — toast in-app, bukan alert browser.
  const handleCloseDone = (res: any | null, error: string | null) => {
    setCloseTarget(null);
    if (error) {
      pushToast("error", "Gagal menutup posisi", error);
      return;
    }
    const pnl = res?.realized_pnl_usdt;
    const sym = res?.trade?.symbol ?? "";
    pushToast(
      "success",
      `${sym} ditutup`,
      typeof pnl === "number"
        ? `Exit $${money(res.exit_price ?? 0, 4)} · PnL ${pnl >= 0 ? "+" : "-"}$${money(Math.abs(pnl))}`
        : undefined,
    );
    loadEngine();
  };

  const [trades, setTrades] = useState<Trade[]>([
    { id: 1, pair: "BTC/USDT", type: "LONG", pnl: "+12.4%", date: "2026-08-10", notes: "Breakout resistance 62000" }
  ]);
  
  // State untuk kontrol Modal
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  
  // State untuk mode Edit
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // State untuk form input
  const [newPair, setNewPair] = useState("");
  const [newType, setNewType] = useState("LONG");
  const [newPnl, setNewPnl] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Load data dari local storage
  useEffect(() => {
    setMounted(true);
    const savedTrades = localStorage.getItem("oracle_journal_data");
    if (savedTrades) {
      try {
        setTrades(JSON.parse(savedTrades));
      } catch (e) {
        console.error("Gagal membaca data jurnal dari storage");
      }
    }
  }, []);

  // Simpan data ke local storage tiap kali berubah
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("oracle_journal_data", JSON.stringify(trades));
    }
  }, [trades, mounted]);

  // Buka form untuk entri BARU
  const handleOpenAdd = () => {
    setEditingId(null);
    setNewPair(""); setNewType("LONG"); setNewPnl(""); setNewNotes("");
    setIsFormModalOpen(true);
  };

  // Buka detail (View)
  const openTradeDetails = (trade: Trade) => {
    setSelectedTrade(trade);
    setIsViewModalOpen(true);
  };

  // Buka form untuk EDIT dari data yang dipilih
  const handleOpenEdit = () => {
    if (!selectedTrade) return;
    setEditingId(selectedTrade.id);
    setNewPair(selectedTrade.pair);
    setNewType(selectedTrade.type);
    
    // Hapus tanda + di awal jika ada saat masuk ke mode edit biar user gampang ngeditnya
    const cleanPnl = selectedTrade.pnl.startsWith("+") ? selectedTrade.pnl.substring(1) : selectedTrade.pnl;
    setNewPnl(cleanPnl);
    
    setNewNotes(selectedTrade.notes);
    
    setIsViewModalOpen(false); // Tutup view modal
    setIsFormModalOpen(true);  // Buka form modal
  };

  // Hapus Jurnal — via modal glass, bukan window.confirm.
  const handleDelete = () => {
    if (!selectedTrade) return;
    setDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (selectedTrade) {
      setTrades((prev) => prev.filter((t) => t.id !== selectedTrade.id));
      pushToast("success", "Entri jurnal dihapus", selectedTrade.pair);
    }
    setDeleteConfirm(false);
    setIsViewModalOpen(false);
  };

  // Simpan data (Bisa untuk BARU maupun EDIT)
  const handleSaveTrade = (e: React.FormEvent) => {
    e.preventDefault();
    const formattedPnl = newPnl.startsWith("+") || newPnl.startsWith("-") ? newPnl : `+${newPnl}`;
    
    if (editingId) {
      // PROSES EDIT DATA
      const updatedTrades = trades.map((trade) => 
        trade.id === editingId 
          ? { ...trade, pair: newPair.toUpperCase(), type: newType, pnl: formattedPnl, notes: newNotes } 
          : trade
      );
      setTrades(updatedTrades);
    } else {
      // PROSES TAMBAH DATA BARU
      const newEntry: Trade = {
        id: Date.now(),
        pair: newPair.toUpperCase(),
        type: newType,
        pnl: formattedPnl,
        date: new Date().toISOString().split('T')[0],
        notes: newNotes,
      };
      setTrades([newEntry, ...trades]);
    }
    
    setIsFormModalOpen(false);
    setEditingId(null);
  };

  if (!mounted) return null;

  return (
    <div className="space-y-6 relative">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">Journal</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50 transition-colors">
            <NotebookPen className="w-8 h-8 text-emerald-500" /> Trading Journal
          </h1>
        </div>
        <button
          onClick={handleOpenAdd}
          title="Buat catatan jurnal manual (bukan membuka posisi pasar)"
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-500 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Journal
        </button>
      </div>

      {/* ORACLE TRADE ENGINE — EXECUTED TRADES (Tugas 2) */}
      <div className="border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl overflow-hidden mt-6 shadow-sm dark:shadow-none">
        <div className="p-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-500" /> Trade Ledger — ORACLE Engine
            </h2>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · auto-refresh 3s
            </div>
          </div>

          {execAccount && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-3">
                <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-zinc-500 flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Total Equity (Net Worth)
                </p>
                <p
                  className={`mt-1 text-lg font-bold font-mono tabular-nums transition-colors ${
                    totalFloating > 0.005
                      ? "text-emerald-600 dark:text-emerald-400"
                      : totalFloating < -0.005
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  ${money(totalEquity)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-3">
                <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-zinc-500">Floating PnL</p>
                <p
                  className={`mt-1 text-lg font-bold font-mono tabular-nums ${
                    totalFloating > 0.005
                      ? "text-emerald-600 dark:text-emerald-400"
                      : totalFloating < -0.005
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-500 dark:text-zinc-400"
                  }`}
                >
                  {totalFloating >= 0 ? "+" : "-"}${money(Math.abs(totalFloating))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-3">
                <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-zinc-500">Saldo Virtual</p>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  ${money(execAccount.balance_usdt)}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                  realized {execAccount.realized_pnl_usdt >= 0 ? "+" : ""}${money(execAccount.realized_pnl_usdt)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0b0b0d] p-3">
                <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-zinc-500">Posisi Terbuka</p>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {execAccount.open_positions}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                  margin ${money(execAccount.allocated_margin_usdt)}
                </p>
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button
              onClick={loadEngine}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Menyegarkan…" : "Refresh manual"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm min-w-[880px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 dark:bg-zinc-900/50 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="p-3 font-medium">Time</th>
                <th className="p-3 font-medium">Asset</th>
                <th className="p-3 font-medium">Side</th>
                <th className="p-3 font-medium">Mode</th>
                <th className="p-3 font-medium">Entry</th>
                <th className="p-3 font-medium">Current</th>
                <th className="p-3 font-medium">SL / TP</th>
                <th className="p-3 font-medium">Size</th>
                <th className="p-3 font-medium">Margin</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">PnL / Floating (RoE)</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/50">
              {execLoading ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400 dark:text-zinc-500">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : execTrades.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400 dark:text-zinc-500">
                    Belum ada trade dieksekusi. Buka proposal dari AI Chat atau Scanner.
                  </td>
                </tr>
              ) : (
                execTrades.map((t) => {
                  const cur = livePrices[t.symbol];
                  const fPnl = floatingPnl(t, cur);
                  const fRoe = roePct(t, fPnl);
                  const isOpen = t.status === "OPEN";
                  return (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-zinc-900/30">
                    <td className="p-3 text-slate-500 dark:text-zinc-400 font-mono whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="p-3 font-bold text-slate-900 dark:text-white">{t.symbol}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.side === "BUY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500" : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-500"}`}>
                        {t.side}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                        {t.mode === "PAPER_TRADING" ? <Beaker className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                        {t.mode === "PAPER_TRADING"
                          ? "PAPER"
                          : `LIVE ${(t.exchange_label || t.mode.replace("LIVE_", "")).toUpperCase()}${t.market_type ? " · " + t.market_type.toUpperCase() : ""}`}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-zinc-300">{money(entryOf(t), 4)}</td>
                    <td className="p-3 font-mono whitespace-nowrap">
                      {isOpen ? (
                        typeof cur === "number" ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-900 dark:text-white">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {money(cur, 4)}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-zinc-600">…</span>
                        )
                      ) : (
                        <span className="font-mono text-slate-500 dark:text-zinc-400">
                          {money(t.exit_price, 4)}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-500 dark:text-zinc-400 whitespace-nowrap">
                      <span className="text-red-500">{money(t.stop_loss_price, 4)}</span>
                      {" / "}
                      <span className="text-emerald-500">{(t.take_profit_targets || []).map((x) => money(x, 4)).join(", ")}</span>
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-zinc-300">{t.position_size_coin}</td>
                    <td className="p-3 font-mono text-slate-700 dark:text-zinc-300">${money(t.allocated_margin_usdt)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isOpen ? "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : t.status === "CLOSED" ? "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400" : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-semibold whitespace-nowrap tabular-nums">
                      {isOpen ? (
                        fPnl === null ? (
                          <span className="text-slate-400 dark:text-zinc-600">calculating…</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 ${
                              fPnl >= 0
                                ? "text-emerald-500 dark:text-emerald-400"
                                : "text-red-500 dark:text-red-400"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                                fPnl >= 0 ? "bg-emerald-500" : "bg-red-500"
                              }`}
                            />
                            {fPnl >= 0 ? "+" : "-"}${money(Math.abs(fPnl))}
                            {fRoe !== null && (
                              <span className="opacity-80">
                                ({fRoe >= 0 ? "+" : ""}{fRoe.toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        )
                      ) : typeof t.realized_pnl_usdt === "number" ? (
                        <span className={t.realized_pnl_usdt >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500"}>
                          {t.realized_pnl_usdt >= 0 ? "+" : "-"}${money(Math.abs(t.realized_pnl_usdt))}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isOpen && t.mode === "PAPER_TRADING" && (
                        <button
                          onClick={() => setCloseTarget(t)}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:border-rose-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                        >
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE SECTION */}
      <div className="border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl overflow-hidden mt-6 shadow-sm dark:shadow-none transition-colors duration-500">
        <div className="px-4 pt-4 text-sm font-semibold text-slate-900 dark:text-white">Manual Journal</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 dark:bg-zinc-900/50 dark:border-zinc-800 dark:text-zinc-400 transition-colors">
            <tr>
              <th className="p-4 font-medium">Date</th>
              <th className="p-4 font-medium">Asset Pair</th>
              <th className="p-4 font-medium">Position</th>
              <th className="p-4 font-medium">PnL Result</th>
              <th className="p-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/50 transition-colors">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400 dark:text-zinc-500">
                  No trades recorded yet. Click "New Entry" to log your first trade.
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr 
                  key={trade.id} 
                  onClick={() => openTradeDetails(trade)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-900/30 transition-colors"
                  title="Click to view full details"
                >
                  <td className="p-4 text-slate-500 dark:text-zinc-400">{trade.date}</td>
                  <td className="p-4 font-bold text-slate-900 dark:text-white">{trade.pair}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
                      trade.type === "LONG" 
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500" 
                        : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-500"
                    }`}>
                      {trade.type}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className={`flex items-center gap-1 font-mono font-medium transition-colors ${
                      trade.pnl.startsWith("+") 
                        ? "text-emerald-600 dark:text-emerald-500" 
                        : "text-red-600 dark:text-red-500"
                    }`}>
                      {trade.pnl.startsWith("+") ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />} 
                      {trade.pnl}
                    </div>
                  </td>
                  <td className="p-4 text-slate-500 dark:text-zinc-400 max-w-[200px] truncate">{trade.notes}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* POPUP MODAL: ADD / EDIT ENTRY FORM */}
      {isFormModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-colors">
          <div className="bg-white border-slate-200 dark:bg-[#09090b] dark:border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-xl dark:shadow-none transition-colors duration-300">
            
            <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-zinc-800 transition-colors">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editingId ? "Edit Trade" : "Log New Trade"}
              </h2>
              <button onClick={() => setIsFormModalOpen(false)} className="text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTrade} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500 dark:text-zinc-400">Asset Pair</label>
                  <input 
                    required 
                    value={newPair} 
                    onChange={(e) => setNewPair(e.target.value)} 
                    placeholder="e.g., BTC/USDT" 
                    className="w-full bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500 dark:text-zinc-400">Position</label>
                  <select 
                    value={newType} 
                    onChange={(e) => setNewType(e.target.value)} 
                    className="w-full bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  >
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500 dark:text-zinc-400">PnL % (use + or -)</label>
                <input 
                  required 
                  value={newPnl} 
                  onChange={(e) => setNewPnl(e.target.value)} 
                  placeholder="e.g., +5.5% or -2.1%" 
                  className="w-full bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-2.5 text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" 
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500 dark:text-zinc-400">Trade Notes & Lessons</label>
                <textarea 
                  required 
                  value={newNotes} 
                  onChange={(e) => setNewNotes(e.target.value)} 
                  rows={3} 
                  placeholder="Why did you take this trade?" 
                  className="w-full bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" 
                />
              </div>
              
              <button type="submit" className="w-full bg-emerald-600 text-white font-medium rounded-lg p-2.5 mt-2 hover:bg-emerald-500 transition-colors shadow-sm">
                {editingId ? "Save Changes" : "Save Trade to Journal"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* POPUP MODAL: VIEW TRADE DETAILS WITH EDIT/DELETE ACTIONS */}
      {isViewModalOpen && selectedTrade && (
        <div className="fixed inset-0 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-colors">
          <div className="bg-white border-slate-200 dark:bg-[#09090b] dark:border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-xl dark:shadow-none transition-colors duration-300">
            
            <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-zinc-800 transition-colors">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
                <FileText className="w-5 h-5 text-emerald-500" /> Trade Details
              </h2>
              <button onClick={() => setIsViewModalOpen(false)} className="text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Asset Pair</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{selectedTrade.pair}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Date</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-zinc-200 mt-1">{selectedTrade.date}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Position</p>
                  <span className={`inline-block mt-1 px-3 py-1 rounded text-xs font-bold ${
                    selectedTrade.type === "LONG" 
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500" 
                      : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-500"
                  }`}>
                    {selectedTrade.type}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">PnL Result</p>
                  <div className={`flex items-center gap-1 font-mono font-bold mt-1 ${
                    selectedTrade.pnl.startsWith("+") 
                      ? "text-emerald-600 dark:text-emerald-500" 
                      : "text-red-600 dark:text-red-500"
                  }`}>
                    {selectedTrade.pnl.startsWith("+") ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />} 
                    {selectedTrade.pnl}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-2">Trade Notes & Lessons</p>
                <div className="p-4 bg-slate-50 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl text-sm text-slate-800 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed min-h-[100px]">
                  {selectedTrade.notes}
                </div>
              </div>
              
              {/* EDIT & DELETE BUTTONS IN VIEW MODAL */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-zinc-800 transition-colors">
                <button 
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-500 dark:bg-red-500/10 dark:hover:bg-red-500/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
                <button 
                  onClick={handleOpenEdit}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-white dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors shadow-sm dark:shadow-none"
                >
                  <Edit2 className="w-4 h-4" /> Edit Entry
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: KONFIRMASI TUTUP POSISI (glassmorphism) */}
      <CloseTradeModal
        trade={closeTarget}
        accountId={accountId}
        onCancel={() => setCloseTarget(null)}
        onDone={handleCloseDone}
      />

      {/* MODAL: KONFIRMASI HAPUS ENTRI JURNAL MANUAL */}
      <GlassModal
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        title="Hapus Entri Jurnal"
        icon={<Trash2 className="w-4 h-4 text-rose-400" />}
        footer={
          <>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="flex-1 rounded-xl border border-white/10 py-2.5 px-4 text-sm font-medium text-zinc-400 hover:text-white hover:border-white/20 transition"
            >
              Batal
            </button>
            <button
              onClick={confirmDelete}
              className="flex-1 rounded-xl bg-rose-600/90 hover:bg-rose-500 py-2.5 px-4 font-semibold text-white shadow-lg transition"
            >
              Hapus
            </button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">
          Hapus catatan jurnal untuk{" "}
          <span className="font-mono font-semibold text-white">{selectedTrade?.pair}</span>?
          Tindakan ini tidak bisa dibatalkan.
        </p>
      </GlassModal>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}