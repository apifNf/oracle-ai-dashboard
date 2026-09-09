// Kamus terjemahan ORACLE (EN / ID).
//
// Sengaja objek TypeScript biasa, bukan next-intl: aplikasi ini tidak memakai
// routing per-locale ([locale]/...), jadi menambah middleware + restrukturisasi
// rute hanya untuk dua bahasa itu biaya besar tanpa manfaat. Context + kamus
// statis sudah cukup, ikut ter-tree-shake, dan tidak menambah dependensi.
//
// `en` adalah SUMBER KEBENARAN kunci. `id` diketik sebagai
// Record<TranslationKey, string> supaya kunci yang lupa diterjemahkan menjadi
// error kompilasi, bukan teks Inggris yang diam-diam bocor ke UI Indonesia.

export const en = {
  // --- umum / topbar ---
  "common.language": "Language",
  "common.english": "English",
  "common.indonesian": "Indonesian",

  // --- sidebar ---
  "sidebar.subtitle": "Crypto Analyst",
  "sidebar.signOut": "Sign Out",
  "sidebar.proTier": "PRO TIER",
  "sidebar.freeTier": "FREE TIER",
  "nav.dashboard": "Dashboard",
  "nav.scanner": "Scanner",
  "nav.aiChat": "AI Chat",
  "nav.marketIntelligence": "Market Intelligence",
  "nav.journal": "Journal",
  "nav.technicalAnalyst": "Technical Analyst",
  "nav.settings": "Settings",

  // --- modal autentikasi ---
  "auth.title": "Authentication Required",
  "auth.description": "Please log in to access this module and unlock all ORACLE features.",
  "auth.cancel": "Cancel",
  "auth.continue": "Continue to Login",

  // --- halaman scanner ---
  "scanner.eyebrow": "Scanner",
  "scanner.title": "Live Signal Scanner",
  "scanner.assetsComplete": "{ok}/{total} assets with complete data",
  "scanner.ruleSet": "rule set {rule}",
  "scanner.indicatorsAge": "indicators {age}",
  "scanner.reconnect": "Reconnect",
  "scanner.status.live": "Live Stream",
  "scanner.status.delayed": "Data delayed",
  "scanner.status.reconnecting": "Reconnecting…",
  "scanner.status.connecting": "Connecting…",
  "scanner.status.disconnected": "Disconnected",
  "scanner.streamDown.title": "Exchange price feed disconnected",
  "scanner.streamDown.body":
    "The server is reconnecting ({attempts} attempts). The numbers below are the last data received, not current prices.",
  "scanner.empty.title": "No scanner data",
  "scanner.empty.connected": "Server connected but has not sent any assets yet.",
  "scanner.empty.disconnected": "Connection to the server was lost.",
  "scanner.openCard": "Click the card to view candles",

  // --- onboarding: cara trading di ORACLE ---
  "onboarding.title": "How to trade on ORACLE",
  "onboarding.subtitle": "Three steps from API key to execution.",
  "onboarding.dismiss": "Dismiss",
  "onboarding.step1.title": "Connect Exchange",
  "onboarding.step1.desc": "Securely connect your OKX/Bybit API keys in Settings.",
  "onboarding.step2.title": "Discover Alpha",
  "onboarding.step2.desc": "Find high-probability signals using the Live Scanner.",
  "onboarding.step3.title": "Smart Execution",
  "onboarding.step3.desc":
    "Let Fable 5 AI execute trades directly to your exchange account.",
} as const;

export type TranslationKey = keyof typeof en;

export const id: Record<TranslationKey, string> = {
  // --- umum / topbar ---
  "common.language": "Bahasa",
  "common.english": "Inggris",
  "common.indonesian": "Indonesia",

  // --- sidebar ---
  "sidebar.subtitle": "Analis Kripto",
  "sidebar.signOut": "Keluar",
  "sidebar.proTier": "TIER PRO",
  "sidebar.freeTier": "TIER GRATIS",
  "nav.dashboard": "Dasbor",
  "nav.scanner": "Pemindai",
  "nav.aiChat": "Obrolan AI",
  "nav.marketIntelligence": "Intelijen Pasar",
  "nav.journal": "Jurnal",
  "nav.technicalAnalyst": "Analis Teknikal",
  "nav.settings": "Pengaturan",

  // --- modal autentikasi ---
  "auth.title": "Perlu Autentikasi",
  "auth.description": "Silakan masuk untuk mengakses modul ini dan membuka semua fitur ORACLE.",
  "auth.cancel": "Batal",
  "auth.continue": "Lanjut ke Halaman Masuk",

  // --- halaman scanner ---
  "scanner.eyebrow": "Pemindai",
  "scanner.title": "Pemindai Sinyal Langsung",
  "scanner.assetsComplete": "{ok}/{total} aset dengan data lengkap",
  "scanner.ruleSet": "aturan {rule}",
  "scanner.indicatorsAge": "indikator {age}",
  "scanner.reconnect": "Sambungkan ulang",
  "scanner.status.live": "Aliran Langsung",
  "scanner.status.delayed": "Data tertunda",
  "scanner.status.reconnecting": "Menyambung ulang…",
  "scanner.status.connecting": "Menyambung…",
  "scanner.status.disconnected": "Terputus",
  "scanner.streamDown.title": "Aliran harga bursa terputus",
  "scanner.streamDown.body":
    "Server sedang menyambung ulang ({attempts} percobaan). Angka di bawah adalah data terakhir yang diterima, bukan harga saat ini.",
  "scanner.empty.title": "Tidak ada data scanner",
  "scanner.empty.connected": "Server terhubung tetapi belum mengirim aset apa pun.",
  "scanner.empty.disconnected": "Koneksi ke server terputus.",
  "scanner.openCard": "Klik kartu untuk melihat candle",

  // --- onboarding: cara trading di ORACLE ---
  "onboarding.title": "Cara trading di ORACLE",
  "onboarding.subtitle": "Tiga langkah dari kunci API sampai eksekusi.",
  "onboarding.dismiss": "Tutup",
  "onboarding.step1.title": "Hubungkan Bursa",
  "onboarding.step1.desc": "Hubungkan kunci API OKX/Bybit Anda dengan aman di Pengaturan.",
  "onboarding.step2.title": "Temukan Peluang",
  "onboarding.step2.desc": "Temukan sinyal berprobabilitas tinggi lewat Pemindai Langsung.",
  "onboarding.step3.title": "Eksekusi Pintar",
  "onboarding.step3.desc":
    "Biarkan AI Fable 5 mengeksekusi transaksi langsung ke akun bursa Anda.",
};

export const dictionaries = { en, id } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: Locale[] = ["en", "id"];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  id: "ID",
};
