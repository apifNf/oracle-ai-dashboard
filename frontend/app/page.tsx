"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Brain, NotebookPen } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

type DashboardData = {
  market_regime: string;
  active_signals: number;
  journal_count: number;
  ai_notes: string;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({
    market_regime: "Loading...",
    active_signals: 0,
    journal_count: 0,
    ai_notes: "Connecting to backend...",
  });

  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

  // EFFECT
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/scanner/signals`)
      .then((res) => {
        if (!res.ok) throw new Error("Dashboard endpoint not found");
        return res.json();
      })
      .then((json) => {
        let signalsCount = 0;
        if (Array.isArray(json)) {
          signalsCount = json.length;
        } else if (json && json.signals && Array.isArray(json.signals)) {
          signalsCount = json.signals.length;
        } else if (json && typeof json.active_signals === 'number') {
          signalsCount = json.active_signals;
        }

        setData({
          market_regime: json.market_regime || "Neutral",
          active_signals: signalsCount,
          journal_count: json.journal_count || 0,
          ai_notes: json.ai_notes || "ORACLE online and receiving market data",
        });
      })
      .catch((err) => {
        console.error("Dashboard Fetch Error:", err);
        setData({
          market_regime: "Neutral",
          active_signals: 0,
          journal_count: 0,
          ai_notes: "Connected (Awaiting Market Data)",
        });
      });
  }, [API_BASE_URL]);

  // FUNCTION
  const askAI = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setReply("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status}`);
      }

      const json = await res.json();
      setReply(json.reply || json.response || JSON.stringify(json));
    } catch (err) {
      console.error("AI Chat Error:", err);
      setReply("Failed to contact ORACLE AI. Memastikan backend menyala dan API Key valid.");
    } finally {
      setLoading(false);
    }
  };

  // JSX
  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div>
        <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors duration-500">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-zinc-50 transition-colors duration-500">
          Market command center
        </h1>
      </div>

      {/* METRICS SECTION */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={BarChart3}
          label="Market Regime"
          value={data.market_regime}
          detail="Live backend signal"
        />
        <MetricCard
          icon={Activity}
          label="Active Signals"
          value={String(data.active_signals)}
          detail="Fetched from API"
        />
        <MetricCard
          icon={Brain}
          label="AI Notes"
          value="Online"
          detail={data.ai_notes}
        />
        <MetricCard
          icon={NotebookPen}
          label="Journal"
          value={String(data.journal_count)}
          detail="Trade journal count"
        />
      </div>

      {/* AI ANALYST SECTION */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] p-6 space-y-4 shadow-sm dark:shadow-none transition-colors duration-500">
        <h2 className="text-lg font-medium text-slate-900 dark:text-zinc-50 transition-colors duration-500">
          ORACLE AI Analyst
        </h2>

        {/* Textarea dengan Full Tailwind (Meninggalkan Inline CSS) */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder="Ask ORACLE about BTC, market sentiment, signals..."
          rows={4}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 outline-none transition-all duration-300 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-800 dark:bg-[#09090b] dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-500 dark:focus:ring-emerald-500"
        />

        <button
          onClick={askAI}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 font-medium text-slate-800 transition-colors duration-300 hover:bg-slate-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {loading ? "Analyzing..." : "Ask ORACLE"}
        </button>

        {/* Area Jawaban AI */}
        <div className="min-h-[140px] rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50 transition-colors duration-500">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-zinc-300 transition-colors duration-500">
            {reply || "ORACLE response will appear here."}
          </p>
        </div>
      </section>
    </div>
  );
}