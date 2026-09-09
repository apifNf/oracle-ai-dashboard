"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

/**
 * TradingView Economic Calendar (Events) Widget — SINKRON TEMA.
 *
 *  - config JSON: "colorTheme" (bukan "theme") mengikuti Light/Dark mode aplikasi;
 *    "isTransparent": false supaya TradingView merender background bawaannya
 *    (putih untuk light, #131722 untuk dark) — bukan transparan yang bocor.
 *  - DOM cleansing: kontainer dikosongkan (innerHTML = "") lalu subtree
 *    .tradingview-widget-container DIBUAT ULANG total setiap kali tema berubah,
 *    supaya tidak ada iframe bertema lama yang tersangkut cache DOM.
 *  - src: https://s3.tradingview.com/external-embedding/embed-widget-events.js
 */
export function EconomicCalendar() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const surface = isLight ? "#ffffff" : "#131722";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // 1. Hapus iframe / widget lama.
    host.innerHTML = "";

    // 2. Bangun ulang subtree kontainer TradingView dari nol.
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";
    container.style.backgroundColor = surface;

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "calc(100% - 32px)";
    widget.style.width = "100%";
    container.appendChild(widget);

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright";
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/economic-calendar/" rel="noopener nofollow" target="_blank" style="color:#787b86;font-size:11px;">Economic calendar by TradingView</a>';
    container.appendChild(copyright);

    // 3. Inject script dengan config JSON bertema sesuai mode aktif.
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: isLight ? "light" : "dark",
      isTransparent: false,
      locale: "en",
      countryFilter: "us,eu,gb,jp,cn,de,ca,au",
      importanceFilter: "0,1",
      width: "100%",
      height: "100%",
    });
    container.appendChild(script);

    host.appendChild(container);

    return () => {
      host.innerHTML = "";
    };
  }, [isLight, surface]);

  return (
    <div
      ref={hostRef}
      className={isLight ? "h-full w-full [color-scheme:light]" : "h-full w-full [color-scheme:dark]"}
      style={{ height: "100%", width: "100%", backgroundColor: surface }}
    />
  );
}
