"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; title: string; detail?: string };

/** Hook state toast in-app (bukan alert browser). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, title, detail }]);
      setTimeout(() => dismiss(id), kind === "error" ? 6000 : 4000);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

/** Viewport toast melayang di pojok kanan bawah, gaya glassmorphism dark. */
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 w-[min(360px,calc(100vw-2.5rem))]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#0e1015]/90 backdrop-blur-xl px-4 py-3 shadow-2xl animate-in slide-in-from-right-4 fade-in duration-200"
        >
          <div className="mt-0.5 shrink-0">
            {t.kind === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : t.kind === "error" ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-semibold ${
                t.kind === "error"
                  ? "text-rose-300"
                  : t.kind === "success"
                  ? "text-emerald-300"
                  : "text-sky-300"
              }`}
            >
              {t.title}
            </p>
            {t.detail && <p className="text-xs text-zinc-400 mt-0.5 break-words">{t.detail}</p>}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-zinc-500 hover:text-white transition-colors shrink-0"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
