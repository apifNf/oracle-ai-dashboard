"use client";

// useOrderBook — polling Level 2 yang HANYA hidup selama `enabled === true`.
//
// KONTRAK MEMORI (alasan hook ini ada, bukan fetch biasa di komponen):
//   1. Tidak ada request yang dikirim saat enabled=false. Modal tertutup =
//      nol lalu lintas jaringan, bukan sekadar hasil yang disembunyikan.
//   2. Cleanup mematikan timer DAN membatalkan request yang masih terbang
//      (AbortController), supaya tidak ada callback yang bangun setelah
//      komponen di-unmount dan menahan referensi DOM.
//   3. State hanya menyimpan SATU snapshot terakhir. Tidak ada array riwayat
//      yang tumbuh — ini yang membuat RAM browser tetap datar walau panel
//      dibiarkan terbuka berjam-jam.
//   4. Polling adaptif: tab yang disembunyikan berhenti memanggil (Page
//      Visibility), lanjut lagi saat tab kembali terlihat.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOrderBook,
  type OrderBook,
  type OrderBookMarketType,
} from "@/lib/orderbook";

export type UseOrderBookOptions = {
  /** Panel/modal sedang terbuka? Satu-satunya sakelar aliran data. */
  enabled: boolean;
  marketType?: OrderBookMarketType;
  depth?: number;
  /** Interval polling; 1-2 detik sesuai kebutuhan Level 2. */
  intervalMs?: number;
};

export type UseOrderBookResult = {
  book: OrderBook | null;
  loading: boolean;
  error: string | null;
  /** Bertambah tiap snapshot sukses — dipakai UI untuk indikator "live". */
  ticks: number;
  refresh: () => void;
};

export function useOrderBook(
  symbol: string | null | undefined,
  {
    enabled,
    marketType = "spot",
    depth = 20,
    intervalMs = 1500,
  }: UseOrderBookOptions,
): UseOrderBookResult {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticks, setTicks] = useState(0);

  // Refs supaya efek tidak perlu bergantung pada nilai yang berubah tiap render.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(false);
  const inFlightRef = useRef(false);
  const [manualTick, setManualTick] = useState(0);

  const refresh = useCallback(() => setManualTick((n) => n + 1), []);

  useEffect(() => {
    // Sakelar tunggal: tidak aktif / tidak ada simbol = tidak ada apa-apa.
    if (!enabled || !symbol) {
      setBook(null);
      setError(null);
      setLoading(false);
      return;
    }

    aliveRef.current = true;
    let cancelled = false;

    const schedule = () => {
      if (cancelled || !aliveRef.current) return;
      timerRef.current = setTimeout(run, intervalMs);
    };

    const run = async () => {
      if (cancelled || !aliveRef.current) return;

      // Tab tersembunyi: lewati siklus ini, jangan bakar kuota & baterai.
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      // Jaringan lambat: jangan menumpuk request di atas request.
      if (inFlightRef.current) {
        schedule();
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;

      try {
        const next = await fetchOrderBook(symbol, {
          marketType,
          depth,
          signal: controller.signal,
        });
        if (cancelled || !aliveRef.current) return;
        setBook(next);
        setTicks((n) => n + 1);
        setError(
          next.status === "ok" ? null : next.error?.message ?? "Order book tidak tersedia",
        );
      } catch (err) {
        if (cancelled || !aliveRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Snapshot terakhir sengaja DIPERTAHANKAN: satu request gagal tidak
        // boleh mengosongkan buku yang sedang dibaca trader.
        setError(err instanceof Error ? err.message : "Gagal memuat order book");
      } finally {
        inFlightRef.current = false;
        if (!cancelled && aliveRef.current) {
          setLoading(false);
          schedule();
        }
      }
    };

    setLoading(true);
    run();

    // Tab kembali terlihat -> ambil snapshot segar tanpa menunggu interval.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      // CLEANUP: timer mati, request terbang dibatalkan, listener dilepas.
      cancelled = true;
      aliveRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [symbol, enabled, marketType, depth, intervalMs, manualTick, refresh]);

  return { book, loading, error, ticks, refresh };
}
