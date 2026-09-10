// Content Security Policy ORACLE.
//
// KENAPA INI PENTING DI SINI, LEBIH DARI APLIKASI BIASA:
// Arsitektur non-custodial menyimpan API Key + Secret bursa milik user di
// localStorage. SETIAP skrip yang berhasil dieksekusi di origin ini bisa
// membacanya — itu sifat localStorage, tidak bisa dicabut. Karena itu satu-
// satunya pertahanan nyata adalah MENCEGAH skrip tak sah dieksekusi sejak awal.
// Itulah tugas CSP di bawah.
//
// Strategi: nonce + 'strict-dynamic'.
//   - Hanya <script> yang membawa nonce request ini yang boleh jalan.
//   - 'strict-dynamic' membuat skrip tepercaya boleh memuat skrip lain — inilah
//     yang membuat widget TradingView (di-inject oleh bundle kita sendiri lewat
//     document.createElement) tetap jalan TANPA perlu meng-allowlist host.
//   - 'unsafe-inline' + https: sengaja DITULIS sebagai fallback untuk browser
//     lama; browser yang paham 'strict-dynamic' MENGABAIKAN keduanya. Ini pola
//     strict-CSP yang direkomendasikan, bukan kelonggaran.
//
// Yang TIDAK bisa dijanjikan CSP: begitu sebuah skrip lolos dan berjalan di
// origin ini, localStorage terbuka baginya. CSP mengecilkan permukaan serangan,
// bukan menghilangkannya. Perlindungan sesungguhnya untuk kunci bursa adalah
// (a) kunci trade-only tanpa izin withdraw — ditegakkan key_guard.py di backend,
// dan (b) penyimpanan terenkripsi sisi server bila suatu saat model custodial
// dipilih.

function originOf(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const ws = u.protocol === "https:" ? "wss:" : "ws:";
    // WebSocket scanner (/api/v1/ws/scanner) juga tunduk pada connect-src.
    return [u.origin, `${ws}//${u.host}`];
  } catch {
    return [];
  }
}

/** Bangun header CSP untuk satu request. `nonce` harus unik per request. */
export function buildCsp(nonce: string, isDev: boolean): string {
  const api = originOf(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000");
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Fallback browser lama — diabaikan saat 'strict-dynamic' didukung.
    "https:",
    "'unsafe-inline'",
    // next dev memakai eval untuk HMR; produksi TIDAK boleh punya ini.
    isDev ? "'unsafe-eval'" : "",
  ].filter(Boolean);

  const connectSrc = [
    "'self'",
    ...api,
    ...supabase,
    "https://s3.tradingview.com",
    "https://*.tradingview.com",
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    // Tidak ada <object>/<embed> di aplikasi ini — tutup total.
    "object-src": ["'none'"],
    // Anti-clickjacking: aplikasi keuangan tidak boleh bisa di-iframe orang lain.
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "script-src": scriptSrc,
    // Inline style tidak bisa dihindari: Next/Tailwind dan widget TradingView
    // menulis style langsung ke elemen. Risikonya jauh di bawah inline script —
    // style tidak mengeksekusi kode.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Thumbnail berita datang dari domain penerbit mana pun; gambar tidak
    // mengeksekusi skrip.
    "img-src": ["'self'", "blob:", "data:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // Widget TradingView dirender di dalam iframe miliknya.
    "frame-src": ["'self'", "https://s3.tradingview.com", "https://*.tradingview.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  const parts = Object.entries(directives).map(
    ([key, values]) => `${key} ${values.join(" ")}`,
  );

  // upgrade-insecure-requests menulis ulang SEMUA http:// menjadi https://.
  // Kalau backend masih dilayani lewat http:// (deployment saat ini pakai IP
  // tanpa TLS), directive ini justru MEMATIKAN seluruh panggilan API dan
  // WebSocket scanner. Jadi hanya dipasang kalau memang tidak ada origin http://
  // yang kita andalkan — bukan sekadar "kalau bukan dev".
  const hasInsecureOrigin = [...api, ...supabase].some((o) =>
    o.startsWith("http://") || o.startsWith("ws://"),
  );
  if (!isDev && !hasInsecureOrigin) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

/** Header keamanan non-CSP yang selalu ikut dikirim. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Tidak ada fitur perangkat yang dipakai dashboard ini.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // Batasi origin lain menyematkan resource kita.
  "Cross-Origin-Opener-Policy": "same-origin",
};
