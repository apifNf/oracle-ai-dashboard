// Export jurnal ke CSV.
//
// KEAMANAN — CSV FORMULA INJECTION:
// Excel / Google Sheets mengeksekusi sel yang diawali '=', '+', '-', '@', TAB,
// atau CR sebagai FORMULA. Kolom Notes di jurnal ini berisi teks yang dibentuk
// otomatis dan bisa dipengaruhi nama simbol/isi trade, jadi sel seperti
// `=HYPERLINK(...)` bisa berakhir dieksekusi di mesin siapa pun yang membuka
// file. Setiap sel karena itu diawali kutip tunggal bila dimulai dengan
// karakter berbahaya — file tetap terbaca, formula tidak pernah jalan.

import type { LedgerRow } from "@/lib/ledger";

const DANGEROUS = ["=", "+", "-", "@", "\t", "\r"];

/** Netralkan satu sel: cegah formula, lalu quote sesuai RFC 4180. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (DANGEROUS.some((c) => s.startsWith(c))) s = `'${s}`;
  // Quote kalau mengandung koma, kutip, atau newline; kutip di dalam digandakan.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // CRLF + BOM UTF-8 supaya Excel membuka karakter non-ASCII dengan benar.
  return lines.join("\r\n");
}

const num = (v: unknown, d = 8): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d).replace(/\.?0+$/, "") : "";

export const JOURNAL_CSV_HEADERS = [
  "Trade Type",
  "Source",
  "Opened At",
  "Closed At",
  "Symbol",
  "Side",
  "Mode",
  "Status",
  "Entry Price",
  "Exit Price",
  "Stop Loss",
  "Take Profit",
  "Size",
  "Notional USDT",
  "Margin USDT",
  "Leverage",
  "Gross PnL USDT",
  "Fees USDT",
  "Net PnL USDT",
  "Notes",
];

export function journalRowsToCsv(rows: LedgerRow[]): string {
  const body = rows.map((r) => [
    r.tradeType,
    r.source,
    r.created_at && !r.created_at.startsWith("1970") ? r.created_at : "",
    r.closed_at ?? "",
    r.symbol,
    r.side,
    r.mode,
    r.status,
    num(r.filled_price ?? r.entry_price),
    num(r.exit_price),
    r.stop_loss_price > 0 ? num(r.stop_loss_price) : "",
    (r.take_profit_targets || []).map((t) => num(t)).join(" | "),
    num(r.position_size_coin),
    num(r.notional_usdt, 2),
    num(r.allocated_margin_usdt, 2),
    r.applied_leverage ? `${r.applied_leverage}x` : "",
    num(r.gross_pnl_usdt, 2),
    num(r.fees_usdt, 2),
    num(r.realized_pnl_usdt, 2),
    r.notes ?? "",
  ]);
  return toCsv(JOURNAL_CSV_HEADERS, body);
}

/** Trigger unduhan file di browser, lalu bersihkan object URL. */
export function downloadCsv(filename: string, csv: string): void {
  // ﻿ = BOM, memberi tahu Excel bahwa isinya UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Lepas object URL supaya blob tidak menggantung di memori tab.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
