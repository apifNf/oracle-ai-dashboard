"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Footer actions (buttons). */
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
};

/**
 * Shell modal glassmorphism — tema dark ORACLE.
 * Backdrop gelap + blur, card kaca buram. Menutup via Esc / klik backdrop / X.
 */
export function GlassModal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  closeOnBackdrop = true,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-[#0e1015]/85 border border-white/10 backdrop-blur-xl rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4 text-zinc-200 relative"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-t-2xl" />

        {(title || icon) && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              {icon}
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-white transition-colors -mr-1"
              aria-label="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div>{children}</div>

        {footer && <div className="mt-6 flex gap-3">{footer}</div>}
      </div>
    </div>
  );
}
