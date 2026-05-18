"use client";

import { useEffect, useState } from "react";

type Signal = {
  coin: string;
  signal: string;
  confidence: number;
  rsi: number;
  ema20: number;
  ema50: number;
  trend: string;
};

export default function ScannerPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/scanner/signals")
      .then((res) => res.json())
      .then((data) => {
        setSignals(data.signals || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <main className="p-8 text-white bg-black min-h-screen">
      <h1 className="text-3xl font-bold mb-6">Signal Scanner</h1>

      {loading ? (
        <p>Scanning market...</p>
      ) : (
        <div className="grid gap-4">
          {signals.map((item) => (
            <div
              key={item.coin}
              className="border border-zinc-800 rounded-xl p-5 bg-zinc-950"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  {item.coin} / USDT
                </h2>

                <span
                  className={`px-3 py-1 rounded-full text-sm font-bold ${
                    item.signal === "LONG"
                      ? "bg-green-600"
                      : item.signal === "SHORT"
                      ? "bg-red-600"
                      : "bg-yellow-600"
                  }`}
                >
                  {item.signal}
                </span>
              </div>

              <div className="mt-4 space-y-1 text-sm text-zinc-300">
                <p>Confidence: {item.confidence}%</p>
                <p>RSI: {item.rsi.toFixed(2)}</p>
                <p>EMA20: {item.ema20.toFixed(2)}</p>
                <p>EMA50: {item.ema50.toFixed(2)}</p>
                <p>Trend: {item.trend}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}