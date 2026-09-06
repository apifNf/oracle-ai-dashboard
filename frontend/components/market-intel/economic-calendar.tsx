"use client";

import { useEffect, useRef } from "react";

/**
 * TradingView Economic Calendar (Events) Widget — DIPAKSA DARK.
 * Dibangun sepenuhnya di client (useEffect) — tidak ada SSR/hydration issue.
 * Fokus event makro global: US CPI, The Fed / FOMC, NFP, ECB, dll.
 *
 * Catatan: widget "events" TradingView sering merender body putih saat
 * isTransparent:true. Solusinya: config `colorTheme:"dark"` + `isTransparent:true`
 * DAN latar solid gelap ORACLE (#0e1015) di container pembungkus, sehingga area
 * transparan apa pun tetap tampil gelap dan menyatu dengan terminal.
 */
export function EconomicCalendar() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    widget.style.backgroundColor = "#0e1015";
    host.appendChild(widget);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: "dark",
      isTransparent: true,
      locale: "en",
      countryFilter: "us,eu,gb,jp,cn,de,ca,au",
      importanceFilter: "0,1", // medium + high impact
      width: "100%",
      height: "100%",
    });
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, []);

  return (
    <div
      ref={ref}
      className="tradingview-widget-container h-full w-full bg-[#0e1015] [color-scheme:dark]"
      style={{ height: "100%", width: "100%", backgroundColor: "#0e1015" }}
    />
  );
}
