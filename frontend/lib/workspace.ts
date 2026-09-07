// Workspace Configuration — Primary Exchange + Trading Environment.
// Disimpan di localStorage oleh halaman Settings (key: oracle_exchange /
// oracle_environment). Dibaca komponen eksekusi (TradeProposalTicket) agar
// tombol & payload menyesuaikan otomatis. TIDAK ada hardcode "Binance".

import { useEffect, useState } from "react";

export const EXCHANGES: { id: string; label: string }[] = [
  { id: "okx", label: "OKX" },
  { id: "mexc", label: "MEXC" },
  { id: "bybit", label: "Bybit" },
  { id: "indodax", label: "Indodax" },
  { id: "binance", label: "Binance" },
];

export type MarketType = "spot" | "futures";
export type WorkspaceConfig = { exchange: string; environment: MarketType };

const KEY_EX = "oracle_exchange";
const KEY_ENV = "oracle_environment";
export const WORKSPACE_EVENT = "oracle:workspace-updated";

const DEFAULT: WorkspaceConfig = { exchange: "binance", environment: "spot" };

export function exchangeLabel(id: string): string {
  return EXCHANGES.find((e) => e.id === id)?.label ?? (id ? id.toUpperCase() : "Exchange");
}

export function getWorkspace(): WorkspaceConfig {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const exchange = (localStorage.getItem(KEY_EX) || DEFAULT.exchange).toLowerCase();
    const env = (localStorage.getItem(KEY_ENV) || DEFAULT.environment).toLowerCase();
    return {
      exchange: EXCHANGES.some((e) => e.id === exchange) ? exchange : DEFAULT.exchange,
      environment: env === "futures" || env === "perpetual" ? "futures" : "spot",
    };
  } catch {
    return DEFAULT;
  }
}

export function saveWorkspace(cfg: WorkspaceConfig): void {
  try {
    localStorage.setItem(KEY_EX, cfg.exchange);
    localStorage.setItem(KEY_ENV, cfg.environment);
    window.dispatchEvent(new Event(WORKSPACE_EVENT));
  } catch {
    /* ignore */
  }
}

/** Reaktif: ikut berubah saat Settings di-save atau tab lain mengubahnya. */
export function useWorkspace(): WorkspaceConfig {
  const [cfg, setCfg] = useState<WorkspaceConfig>(DEFAULT);
  useEffect(() => {
    const sync = () => setCfg(getWorkspace());
    sync();
    window.addEventListener(WORKSPACE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WORKSPACE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return cfg;
}
