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

  // EFFECT
  useEffect(() => {
    fetch("http://localhost:8000/api/v1/dashboard")
      .then((res) => res.json())
      .then((json) => setData(json))
      .catch((err) => {
        console.error(err);
      });
  }, []);

  // FUNCTION
  const askAI = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setReply("");

    try {
      const res = await fetch("http://localhost:8000/api/v1/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
        }),
      });

      const json = await res.json();
      setReply(json.reply);
    } catch (err) {
      console.error(err);
      setReply("Failed to contact ORACLE AI.");
    } finally {
      setLoading(false);
    }
  };

  // JSX
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.24em] text-accent">
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

      <section className="rounded-lg border p-6 space-y-4">
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
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    padding: "16px",
    fontSize: "14px",
    outline: "none",
  }}
/>

        <button
          onClick={askAI}
          disabled={loading}
          className="rounded-lg border px-4 py-2"
        >
          {loading ? "Analyzing..." : "Ask ORACLE"}
        </button>

        <div className="rounded-lg border p-4 min-h-[140px]">
          <p className="text-sm whitespace-pre-wrap">
            {reply || "ORACLE response will appear here."}
          </p>
        </div>
      </section>
    </div>
  );
}