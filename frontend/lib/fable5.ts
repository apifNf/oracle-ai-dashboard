// Formatter untuk keputusan JSON FABLE 5 (TIER 2 dari /api/v1/ai/route).
// Dipakai di Quick Ask Dashboard dan halaman /ai-chat supaya respons TIER 2
// tampil rapi sebagai teks, bukan JSON mentah.

export type Fable5Decision = {
  execution_status?: "APPROVED" | "DENIED" | "OVERRIDE_TRIGGERED" | string;
  decision_reasoning?: string;
  order_payload?: {
    exchange_target?: string;
    symbol?: string;
    action?: string;
    order_type?: string;
    calculated_quantity_coin?: number;
    allocated_margin_usdt?: number;
    applied_leverage?: number;
    risk_management?: {
      stop_loss_price?: number;
      take_profit_targets?: number[];
    };
  };
  risk_assessment?: {
    systemic_volatility_score?: string;
    applied_guardrail_caps?: string;
  };
};

export function formatFable5Decision(d: Fable5Decision | null | undefined): string {
  if (!d || typeof d !== "object") {
    return "FABLE 5 tidak mengembalikan keputusan yang valid.";
  }

  const lines: string[] = [];
  lines.push(`🧠 FABLE 5 — Quant Core · ${d.execution_status ?? "—"}`);
  if (d.risk_assessment?.systemic_volatility_score) {
    lines.push(`Volatilitas sistemik: ${d.risk_assessment.systemic_volatility_score}`);
  }
  lines.push("");
  if (d.decision_reasoning) lines.push(d.decision_reasoning.trim());

  const op = d.order_payload;
  const approved =
    d.execution_status === "APPROVED" || d.execution_status === "OVERRIDE_TRIGGERED";

  if (op && approved && (op.calculated_quantity_coin ?? 0) > 0) {
    lines.push("");
    lines.push("Usulan order (tinjau manual — TIDAK dieksekusi otomatis):");
    lines.push(
      `• ${op.symbol ?? "—"} · ${op.action ?? "—"} · ${op.order_type ?? "—"} @ ${op.exchange_target ?? "—"}`,
    );
    lines.push(
      `• Qty: ${op.calculated_quantity_coin} · Margin: ${op.allocated_margin_usdt} USDT · Leverage: ${op.applied_leverage ?? "—"}x`,
    );
    if (op.risk_management) {
      if (op.risk_management.stop_loss_price != null) {
        lines.push(`• Stop loss: ${op.risk_management.stop_loss_price}`);
      }
      const tps = op.risk_management.take_profit_targets ?? [];
      if (tps.length) lines.push(`• Take profit: ${tps.join(" / ")}`);
    }
  }

  if (d.risk_assessment?.applied_guardrail_caps) {
    lines.push("");
    lines.push(`Guardrail: ${d.risk_assessment.applied_guardrail_caps}`);
  }

  return lines.join("\n");
}
