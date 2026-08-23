"use client";

import { useState, useEffect } from "react";
import { NotebookPen, Plus, ArrowUpRight, ArrowDownRight, X, FileText, Edit2, Trash2 } from "lucide-react";

type Trade = { id: number; pair: string; type: string; pnl: string; date: string; notes: string; };

export default function JournalPage() {
  const [mounted, setMounted] = useState(false);
  
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

  // Hapus Jurnal
  const handleDelete = () => {
    if (!selectedTrade) return;
    if (window.confirm(`Are you sure you want to delete the journal entry for ${selectedTrade.pair}?`)) {
      const filteredTrades = trades.filter((t) => t.id !== selectedTrade.id);
      setTrades(filteredTrades);
      setIsViewModalOpen(false);
    }
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
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-500 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Entry
        </button>
      </div>

      {/* TABLE SECTION */}
      <div className="border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] rounded-xl overflow-hidden mt-6 shadow-sm dark:shadow-none transition-colors duration-500">
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
    </div>
  );
}