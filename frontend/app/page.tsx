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
        // Logika penghitungan sinyal yang akurat dan dinamis
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
      <div>
        <p className="text-sm uppercase tracking-[0.24em] text-accent text-zinc-400">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          Market command center
        </h1>
      </div>

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

      <section className="rounded-lg border border-zinc-800 bg-[#09090b] p-6 space-y-4">
        <h2 className="text-lg font-medium">ORACLE AI Analyst</h2>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder="Ask ORACLE about BTC, market sentiment, signals..."
          rows={4}
          style={{
            width: "100%",
            backgroundColor: "#09090b",
            color: "#ffffff",
            border: "1px solid #27272a", // zinc-800
            borderRadius: "12px",
            padding: "16px",
            fontSize: "14px",
            outline: "none",
          }}
        />

        <button
          onClick={askAI}
          disabled={loading}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Ask ORACLE"}
        </button>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 min-h-[140px]">
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-zinc-300">
            {reply || "ORACLE response will appear here."}
          </p>
        </div>
      </section>
    </div>
  );
}