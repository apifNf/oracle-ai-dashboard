"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** Symbol TradingView, mis. "BINANCE:BTCUSDT". */
  symbol: string;
  /** Default timeframe. "15" atau "60". */
  interval?: string;
};

/**
 * TradingView Advanced Real-Time Chart — embed resmi.
 * Dimuat sepenuhnya di client (useEffect) supaya tidak memicu error SSR/hydration.
 * Widget dibangun ulang setiap kali `symbol` berubah.
 */
export function TradingViewChart({ symbol, interval = "60" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // Bersihkan instance sebelumnya.
    host.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    host.appendChild(widget);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1", // candles
      locale: "en",
      enable_publishing: false,
      withdateranges: true,
      hide_side_toolbar: false, // drawing tools (kiri)
      hide_top_toolbar: false, // indicators / timeframes (atas)
      allow_symbol_change: true,
      details: true,
      calendar: false,
      backgroundColor: "rgba(10, 10, 10, 1)",
      gridColor: "rgba(255, 255, 255, 0.06)",
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container h-full w-full"
      style={{ height: "100%", width: "100%" }}
    />
  );
}
