// Workspace Configuration — Primary Exchange, Trading Environment, dan
// kredensial bursa milik user (SaaS publik / NON-CUSTODIAL).
//
// Disimpan di localStorage oleh halaman Settings. Dibaca komponen eksekusi
// (TradeProposalTicket) agar tombol & payload menyesuaikan otomatis. TIDAK ada
// hardcode "Binance".
//
// MODEL KEAMANAN: kunci bursa hidup di browser user, tidak pernah disimpan di
// database ORACLE. Kunci hanya ikut di body request saat user menekan tombol
// eksekusi, lalu dipakai sekali di server untuk memanggil bursa dan dibuang.
// Konsekuensinya: localStorage bisa dibaca skrip apa pun di origin ini, jadi
// pakai API key bursa yang dibatasi (trade-only, TANPA withdraw, IP whitelist)
// dan hanya lewat HTTPS.

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
const KEY_API = "oracle_exchange_key";
const KEY_SECRET = "oracle_exchange_secret";
const KEY_PASSPHRASE = "oracle_exchange_passphrase";
export const WORKSPACE_EVENT = "oracle:workspace-updated";

const DEFAULT: WorkspaceConfig = { exchange: "binance", environment: "spot" };

/** Bursa yang mewajibkan passphrase selain API Key + Secret Key. */
export const PASSPHRASE_EXCHANGES = new Set(["okx", "kucoin", "bitget"]);

export function requiresPassphrase(exchangeId: string): boolean {
  return PASSPHRASE_EXCHANGES.has((exchangeId || "").toLowerCase());
}

/** Kredensial bursa milik user — nama field mengikuti payload backend. */
export type ExchangeCredentials = {
  api_key: string;
  secret_key: string;
  passphrase: string;
};

export function getExchangeCredentials(): ExchangeCredentials {
  if (typeof window === "undefined") return { api_key: "", secret_key: "", passphrase: "" };
  try {
    return {
      api_key: localStorage.getItem(KEY_API) || "",
      secret_key: localStorage.getItem(KEY_SECRET) || "",
      passphrase: localStorage.getItem(KEY_PASSPHRASE) || "",
    };
  } catch {
    return { api_key: "", secret_key: "", passphrase: "" };
  }
}

export function saveExchangeCredentials(creds: ExchangeCredentials): void {
  try {
    localStorage.setItem(KEY_API, creds.api_key.trim());
    localStorage.setItem(KEY_SECRET, creds.secret_key.trim());
    localStorage.setItem(KEY_PASSPHRASE, creds.passphrase.trim());
    window.dispatchEvent(new Event(WORKSPACE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Apakah kredensial cukup untuk Auto-Trade di bursa ini?
 * Mengembalikan alasan spesifik supaya UI bisa memberi tahu field mana yang
 * kurang — bukan sekadar "gagal" setelah order ditolak bursa.
 */
export function credentialsStatus(exchangeId: string): { ready: boolean; missing: string[] } {
  const c = getExchangeCredentials();
  const missing: string[] = [];
  if (!c.api_key.trim()) missing.push("API Key");
  if (!c.secret_key.trim()) missing.push("Secret Key");
  if (requiresPassphrase(exchangeId) && !c.passphrase.trim()) missing.push("Passphrase");
  return { ready: missing.length === 0, missing };
}

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
