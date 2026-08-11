"use client";

import { useState } from "react";
import { NotebookPen, Plus, ArrowUpRight, ArrowDownRight, X } from "lucide-react";

type Trade = { id: number; pair: string; type: string; pnl: string; date: string; notes: string; };

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([
    { id: 1, pair: "BTC/USDT", type: "LONG", pnl: "+12.4%", date: "2026-08-10", notes: "Breakout resistance 62000" }
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // State untuk form input
  const [newPair, setNewPair] = useState("");
  const [newType, setNewType] = useState("LONG");
  const [newPnl, setNewPnl] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const handleAddTrade = (e: React.FormEvent) => {
    e.preventDefault();
    const newEntry: Trade = {
      id: Date.now(),
      pair: newPair.toUpperCase(),
      type: newType,
      pnl: newPnl.startsWith("+") || newPnl.startsWith("-") ? newPnl : `+${newPnl}`,
      date: new Date().toISOString().split('T')[0],
      notes: newNotes,
    };
    setTrades([newEntry, ...trades]);
    setIsModalOpen(false);
    setNewPair(""); setNewPnl(""); setNewNotes("");
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-zinc-400">Journal</p>
          <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3">
            <NotebookPen className="w-8 h-8 text-emerald-500" /> Trading Journal
          </h1>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-500 transition-colors">
          <Plus className="w-4 h-4" /> New Entry
        </button>
      </div>

      <div className="border border-zinc-800 bg-[#09090b] rounded-xl overflow-hidden mt-6">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400">
            <tr><th className="p-4 font-medium">Date</th><th className="p-4 font-medium">Asset Pair</th><th className="p-4 font-medium">Position</th><th className="p-4 font-medium">PnL Result</th><th className="p-4 font-medium">Notes</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {trades.map((trade) => (
              <tr key={trade.id} className="hover:bg-zinc-900/30">
                <td className="p-4 text-zinc-400">{trade.date}</td>
                <td className="p-4 font-bold">{trade.pair}</td>
                <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${trade.type === "LONG" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{trade.type}</span></td>
                <td className="p-4"><div className={`flex items-center gap-1 font-mono font-medium ${trade.pnl.startsWith("+") ? "text-emerald-500" : "text-red-500"}`}>{trade.pnl.startsWith("+") ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />} {trade.pnl}</div></td>
                <td className="p-4 text-zinc-400 max-w-xs truncate">{trade.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* POPUP MODAL UNTUK NEW ENTRY */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#09090b] border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold">Log New Trade</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddTrade} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><label className="text-xs text-zinc-400">Asset Pair</label><input required value={newPair} onChange={(e) => setNewPair(e.target.value)} placeholder="e.g., BTC/USDT" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm" /></div>
                <div className="space-y-2"><label className="text-xs text-zinc-400">Position</label><select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm outline-none"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></div>
              </div>
              <div className="space-y-2"><label className="text-xs text-zinc-400">PnL % (use + or -)</label><input required value={newPnl} onChange={(e) => setNewPnl(e.target.value)} placeholder="e.g., +5.5% or -2.1%" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm font-mono" /></div>
              <div className="space-y-2"><label className="text-xs text-zinc-400">Trade Notes & Lessons</label><textarea required value={newNotes} onChange={(e) => setNewNotes(e.target.value)} rows={3} placeholder="Why did you take this trade?" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm" /></div>
              <button type="submit" className="w-full bg-emerald-600 text-white font-medium rounded-lg p-2.5 mt-2 hover:bg-emerald-500 transition-colors">Save Trade to Journal</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}