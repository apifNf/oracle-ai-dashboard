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
//
// Placeholder `{nama}` diisi lewat argumen kedua t(): t("key", { nama: 1 }).
// Placeholder di EN dan ID HARUS sama persis — kalau tidak, interpolasi gagal
// diam-diam di salah satu bahasa saja.

export const en = {
  // ------------------------------------------------------------------ //
  // Umum / topbar
  // ------------------------------------------------------------------ //
  "common.cancel": "Cancel",
  "common.delete": "Delete",

  // ------------------------------------------------------------------ //
  // Sidebar
  // ------------------------------------------------------------------ //
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

  // ------------------------------------------------------------------ //
  // Modal autentikasi
  // ------------------------------------------------------------------ //
  "auth.title": "Authentication Required",
  "auth.description": "Please log in to access this module and unlock all ORACLE features.",
  "auth.cancel": "Cancel",
  "auth.continue": "Continue to Login",

  // ------------------------------------------------------------------ //
  // Dashboard
  // ------------------------------------------------------------------ //
  "dashboard.eyebrow": "COMMAND CENTER",
  "dashboard.title": "Market Overview",
  "dashboard.scanning": "Scanning...",
  "dashboard.card.macro.title": "Macro Regime",
  "dashboard.card.macro.value": "Neutral",
  "dashboard.card.macro.sub": "Live liquidity & volatility index",
  "dashboard.card.alpha.title": "Alpha Signals",
  "dashboard.card.alpha.sub.scanning": "Processing top 30 assets...",
  "dashboard.card.alpha.sub.detected": "High-probability setups detected",
  "dashboard.card.oracle.title": "Oracle Intelligence",
  "dashboard.card.oracle.value": "Standby",
  "dashboard.card.oracle.sub": "Neural network ready for analysis",
  "dashboard.card.sentiment.title": "Global Sentiment",
  "dashboard.card.sentiment.value": "Greed",
  "dashboard.card.sentiment.sub": "Macro & on-chain data aggregated",
  "dashboard.card.ledger.title": "Trade Ledger",
  "dashboard.card.ledger.sub": "Paper balance ${balance} · executed trades",
  "dashboard.card.ledger.loading": "Loading ledger…",
  "dashboard.card.system.title": "System Core",
  "dashboard.card.system.value": "Optimal",
  "dashboard.card.system.sub": "Latency: 14ms | Uptime: 99.9%",
  "dashboard.quickAsk.title": "Quick Ask ORACLE",
  "dashboard.quickAsk.placeholder":
    "Ask about macro events, BTC structure, or fetch a quick analysis...",
  "dashboard.quickAsk.processing": "ORACLE is processing request...",

  // ------------------------------------------------------------------ //
  // Scanner
  // ------------------------------------------------------------------ //
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

  // Peringatan risiko
  "scanner.risk.title": "Risk Warning — Not Financial Advice",
  "scanner.risk.bodyBefore": "Signals on this page are produced by deterministic technical rules that are",
  "scanner.risk.bodyStrong": "not backtested against historical data",
  "scanner.risk.bodyAfter":
    ". There is no calibrated probability, no accuracy guarantee, and no profit projection. Trading crypto assets carries high risk and can result in the loss of your entire capital. Trading decisions are entirely your own responsibility. ORACLE does not provide investment recommendations.",

  // Kartu aset
  "scanner.card.criteriaMet": "Criteria met",
  "scanner.card.noCriteria": "No directional criteria met.",
  "scanner.card.trend": "Trend",
  "scanner.card.noSignal": "No signal",
  "scanner.trend.bullish": "Bullish",
  "scanner.trend.bearish": "Bearish",
  "scanner.card.notCalculated":
    "Indicators are not calculated for this asset. No numbers are shown, so nothing here can mislead you.",
  "scanner.locked.title": "Pro Alpha Signal",
  "scanner.locked.subtitle": "Click to upgrade — unlock",

  // Kriteria teknikal
  "scanner.criteria.ema20AboveEma50": "EMA20 above EMA50",
  "scanner.criteria.ema20BelowEma50": "EMA20 below EMA50",
  "scanner.criteria.rsiBelowOverbought": "RSI below 70",
  "scanner.criteria.rsiAboveOversold": "RSI above 30",
  "scanner.criteria.rsiAboveMidline": "RSI above 50",
  "scanner.criteria.rsiBelowMidline": "RSI below 50",

  // Status aset
  "scanner.assetStatus.ok": "Current",
  "scanner.assetStatus.stale": "Delayed",
  "scanner.assetStatus.pending": "Pending",
  "scanner.assetStatus.unavailable": "Unavailable",
  "scanner.assetStatus.insufficientHistory": "Not enough history",
  "scanner.assetStatus.blocked": "Halted",
  "scanner.assetStatus.unknownSymbol": "Unknown",
  "scanner.assetDetail.ok": "",
  "scanner.assetDetail.stale": "The last price is already a while old.",
  "scanner.assetDetail.pending": "Indicators have not finished calculating.",
  "scanner.assetDetail.unavailable": "Price data cannot be fetched yet.",
  "scanner.assetDetail.insufficientHistory": "Not enough candles for converged indicators.",
  "scanner.assetDetail.blocked": "Calculation cancelled because the price data is faulty.",
  "scanner.assetDetail.unknownSymbol": "Asset is not in the list.",

  // Umur data
  "scanner.age.unknown": "—",
  "scanner.age.seconds": "{value}s ago",
  "scanner.age.minutes": "{value}m ago",
  "scanner.age.hours": "{value}h ago",

  // ------------------------------------------------------------------ //
  // AI Chat
  // ------------------------------------------------------------------ //
  "chat.eyebrow": "Oracle Terminal",
  "chat.title": "Analysis Workspace",
  "chat.proActive": "Pro Alpha Active",
  "chat.initialMessage":
    "ORACLE System Online. What asset or market structure would you like to analyze today?",
  "chat.placeholder": "Ask about BTC structure, funding rates, or attach a chart...",
  "chat.placeholderLocked": "Oracle AI is locked...",
  "chat.processing": "Processing market data...",
  "chat.proUnlimited": "PRO — Unlimited FABLE 5 prompts",
  "chat.quotaReached": "Free limit (0/{limit}) reached — Upgrade to PRO ($49, USDC/USDT)",
  "chat.freePrompts": "Free Alpha Prompts:",
  "chat.upgrade": "Upgrade",
  "chat.locked.title": "Pro Alpha Required",
  "chat.locked.subtitle": "Click to upgrade — unlimited Oracle AI + FABLE 5",

  // ------------------------------------------------------------------ //
  // Market Intelligence
  // ------------------------------------------------------------------ //
  "intel.eyebrow": "Market Intelligence",
  "intel.title.pro": "Analytical Terminal",
  "intel.title.free": "Macro & On-Chain",
  "intel.liveFeed": "LIVE · PRO FEED",
  "intel.alphaNews": "Alpha News Feed",
  "intel.preview": "(preview)",
  "intel.noHeadlines": "No headlines yet.",
  "intel.onchainStream": "oracle@onchain — stream",
  "intel.awaitingWhale": "> awaiting whale flow (> $250k)",
  "intel.macroEvents": "Macro & Government Events",
  "intel.macroSub": "US CPI · The Fed · NFP · ECB · global",
  "intel.paywall.title": "Upgrade to PRO for the Real-Time Alpha Feed & Deep On-Chain Stream",
  "intel.paywall.body":
    "Live CryptoCompare / RSS news with thumbnails & sentiment tags, a real-time on-chain whale-alert terminal (> $500k), and the Macro Economic Calendar (US CPI, The Fed, NFP). FREE only sees a news preview.",
  "intel.paywall.cta": "Upgrade to PRO — $49/mo (USDC/USDT)",

  // ------------------------------------------------------------------ //
  // Journal
  // ------------------------------------------------------------------ //
  "journal.eyebrow": "Journal",
  "journal.title": "Trading Journal",
  "journal.newJournal": "New Journal",
  "journal.newJournalTitle": "Create a manual journal note (does not open a market position)",
  "journal.ledgerTitle": "Trade Ledger — ORACLE Engine",
  "journal.liveRefresh": "Live · auto-refresh 3s",
  "journal.totalEquity": "Total Equity (Net Worth)",
  "journal.floatingPnl": "Floating PnL",
  "journal.virtualBalance": "Virtual Balance",
  "journal.openPositions": "Open Positions",
  "journal.calculating": "calculating…",
  "journal.closePosition": "Close",
  "journal.emptyLedger": "No trades executed yet. Open a proposal from AI Chat or Scanner.",
  "journal.table.time": "Time",
  "journal.table.asset": "Asset",
  "journal.table.side": "Side",
  "journal.table.mode": "Mode",
  "journal.table.entry": "Entry",
  "journal.table.current": "Current",
  "journal.table.slTp": "SL / TP",
  "journal.table.size": "Size",
  "journal.table.margin": "Margin",
  "journal.table.status": "Status",
  "journal.table.pnl": "PnL / Floating (RoE)",
  "journal.manual.title": "Manual Journal",
  "journal.manual.date": "Date",
  "journal.manual.assetPair": "Asset Pair",
  "journal.manual.position": "Position",
  "journal.manual.pnlResult": "PnL Result",
  "journal.manual.notes": "Notes",
  "journal.manual.empty": 'No trades recorded yet. Click "New Journal" to log your first trade.',
  "journal.manual.viewDetails": "Click to view full details",
  "journal.form.pnlPercent": "PnL % (use + or -)",
  "journal.form.notesLabel": "Trade Notes & Lessons",
  "journal.form.assetPlaceholder": "e.g., BTC/USDT",
  "journal.form.pnlPlaceholder": "e.g., +5.5% or -2.1%",
  "journal.form.notesPlaceholder": "Why did you take this trade?",
  "journal.details.title": "Trade Details",
  "journal.details.edit": "Edit Entry",
  "journal.delete.title": "Delete Journal Entry",
  "journal.delete.warning": "This action cannot be undone.",

  // ------------------------------------------------------------------ //
  // Settings
  // ------------------------------------------------------------------ //
  "settings.eyebrow": "Settings",
  "settings.title": "Workspace Configuration",
  "settings.exchangeConnectivity": "Exchange Connectivity",
  "settings.primaryExchange": "Primary Exchange",
  "settings.tradingEnvironment": "Trading Environment",
  "settings.spotMarket": "Spot Market",
  "settings.perpetualFutures": "Perpetual Futures",
  "settings.apiKeysSecurity": "API Keys & Security",
  "settings.openAiLabel": "ORACLE AI Engine (OpenAI Key)",
  "settings.credentials.title": "{exchange} Auto-Trade Credentials",
  "settings.credentials.ready": "Auto-Trade Ready",
  "settings.credentials.missing": "Missing: {fields}",
  "settings.credentials.helpBefore": "All three keys below are",
  "settings.credentials.helpStrong": "required for Auto-Trade",
  "settings.credentials.helpAfter":
    "using your own exchange account. Without a complete set, ORACLE can only run Paper Trading and dry runs.",
  "settings.apiKey": "Exchange API Key",
  "settings.secretKey": "Exchange Secret Key",
  "settings.passphrase": "Exchange Passphrase (OKX/KuCoin only)",
  "settings.passphraseRequired": "— required for {exchange}",
  "settings.apiKeyPlaceholder": "Enter API Key",
  "settings.secretKeyPlaceholder": "Enter Secret Key",
  "settings.passphraseRequiredPlaceholder": "Required for this exchange",
  "settings.passphraseOptionalPlaceholder": "Leave empty if your exchange does not use one",
  "settings.field.apiKey": "API Key",
  "settings.field.secretKey": "Secret Key",
  "settings.field.passphrase": "Passphrase",
  "settings.security.strong": "Non-custodial:",
  "settings.security.body":
    "keys are stored in your browser's local storage and never enter an ORACLE database. They are sent to the server only when you press execute, used once to call the exchange, then discarded.",
  "settings.warning.body":
    "Create exchange API keys with {trade} permission only — {withdraw} and enable an IP whitelist where available. Anyone with access to this browser can read local storage, so never use a key that can withdraw funds.",
  "settings.warning.trade": "Trade-only",
  "settings.warning.withdraw": "disable Withdraw",
  "settings.save": "Save Configuration",
  "settings.saved": "Configuration Saved!",

  // ------------------------------------------------------------------ //
  // Modal Upgrade PRO (billing)
  // ------------------------------------------------------------------ //
  "billing.title": "Upgrade to ORACLE PRO",
  "billing.period": "/ month · {days} days",
  "billing.later": "Later",
  "billing.preparing": "Preparing…",
  "billing.payCta": "Pay ${price} via Crypto (USDC/USDT)",
  "billing.multiChain": "Pay with multi-chain stablecoins:",
  "billing.benefit.prompts": "Unlimited FABLE 5 Prompts (with Actionable Trader's Take)",
  "billing.benefit.strategy": "Deep Actionable Strategy & Trader's Take (not just raw data)",
  "billing.benefit.intel":
    "Real-Time Market Intel (Live CryptoCompare News, Macro Economic Calendar, & Hardcore Whale Terminal)",
  "billing.benefit.quant": "Priority Opus quant model (claude-opus-5)",
  "billing.benefit.scanner": "Live Signal Scanner Alerts",
  "billing.benefit.autotrade": "Autotrade Engine (paper + live guardrails)",
  "billing.toast.sandbox": "Sandbox mode — simulated checkout",
  "billing.toast.opening": "Opening Coinbase checkout…",
  "billing.toast.failed": "Failed to create charge",

  // ------------------------------------------------------------------ //
  // FAQ (halaman Settings)
  // ------------------------------------------------------------------ //
  "faq.title": "Frequently Asked Questions",
  "faq.subtitle": "Getting started with ORACLE and your exchange keys.",
  "faq.q1": "What is ORACLE?",
  "faq.a1":
    "ORACLE is a non-custodial AI crypto trading terminal. We use advanced AI models to provide high-probability signals and execute trades automatically.",
  "faq.q2": "How to create an API Key on a CEX?",
  "faq.a2":
    'Log into your exchange account (Binance, OKX, Bybit, etc.), navigate to "API Management", and create a new key. Ensure you ENABLE "Spot Trading" and DISABLE "Withdrawals" for security.',
  "faq.q3": "How to connect API to ORACLE?",
  "faq.a3":
    "Copy the API Key and Secret Key from your exchange, then paste them into the Workspace configuration above. Your keys are securely stored in your browser's local storage.",
  "faq.q4": "Are my API Keys safe on ORACLE?",
  // CATATAN AKURASI: klaim awal "never sent to our servers" TIDAK benar —
  // pada order LIVE kunci memang dikirim di body request (dipakai sekali di
  // memori lalu dibuang, lihat lib/trade.ts + resolve_credentials). Yang benar
  // adalah kunci tidak pernah DISIMPAN. Janji keamanan yang bisa dipatahkan
  // dengan membuka devtools justru menghancurkan kepercayaan yang mau dibangun.
  "faq.a4":
    "Absolutely safe. ORACLE uses a non-custodial architecture. Your secret keys are securely stored locally in your browser (Local Storage) and are never stored in our server databases \u2014 they are transmitted only at the moment you execute a trade, used once to place the order on your exchange, then discarded.",

  // ------------------------------------------------------------------ //
  // Onboarding: cara trading di ORACLE
  // ------------------------------------------------------------------ //
  "onboarding.title": "How to trade on ORACLE",
  "onboarding.subtitle": "Three steps from API key to execution.",
  "onboarding.dismiss": "Dismiss",
  "onboarding.step1.title": "Connect Exchange",
  "onboarding.step1.desc": "Securely connect your Exchange/CEX API keys in Settings.",
  "onboarding.step2.title": "Discover Alpha",
  "onboarding.step2.desc": "Find high-probability signals using the Live Scanner.",
  "onboarding.step3.title": "Smart Execution",
  "onboarding.step3.desc":
    "Let Fable 5 AI execute trades directly to your exchange account.",
} as const;

export type TranslationKey = keyof typeof en;

export const id: Record<TranslationKey, string> = {
  // ------------------------------------------------------------------ //
  // Umum / topbar
  // ------------------------------------------------------------------ //
  "common.cancel": "Batal",
  "common.delete": "Hapus",

  // ------------------------------------------------------------------ //
  // Sidebar
  // ------------------------------------------------------------------ //
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

  // ------------------------------------------------------------------ //
  // Modal autentikasi
  // ------------------------------------------------------------------ //
  "auth.title": "Perlu Autentikasi",
  "auth.description": "Silakan masuk untuk mengakses modul ini dan membuka semua fitur ORACLE.",
  "auth.cancel": "Batal",
  "auth.continue": "Lanjut ke Halaman Masuk",

  // ------------------------------------------------------------------ //
  // Dasbor
  // ------------------------------------------------------------------ //
  "dashboard.eyebrow": "PUSAT KENDALI",
  "dashboard.title": "Ikhtisar Pasar",
  "dashboard.scanning": "Memindai...",
  "dashboard.card.macro.title": "Rezim Makro",
  "dashboard.card.macro.value": "Netral",
  "dashboard.card.macro.sub": "Indeks likuiditas & volatilitas langsung",
  "dashboard.card.alpha.title": "Sinyal Alpha",
  "dashboard.card.alpha.sub.scanning": "Memproses 30 aset teratas...",
  "dashboard.card.alpha.sub.detected": "Setup berprobabilitas tinggi terdeteksi",
  "dashboard.card.oracle.title": "Intelijen Oracle",
  "dashboard.card.oracle.value": "Siaga",
  "dashboard.card.oracle.sub": "Jaringan neural siap menganalisis",
  "dashboard.card.sentiment.title": "Sentimen Global",
  "dashboard.card.sentiment.value": "Serakah",
  "dashboard.card.sentiment.sub": "Data makro & on-chain teragregasi",
  "dashboard.card.ledger.title": "Buku Transaksi",
  "dashboard.card.ledger.sub": "Saldo kertas ${balance} · transaksi tereksekusi",
  "dashboard.card.ledger.loading": "Memuat buku transaksi…",
  "dashboard.card.system.title": "Inti Sistem",
  "dashboard.card.system.value": "Optimal",
  "dashboard.card.system.sub": "Latensi: 14ms | Uptime: 99,9%",
  "dashboard.quickAsk.title": "Tanya Cepat ORACLE",
  "dashboard.quickAsk.placeholder":
    "Tanya soal peristiwa makro, struktur BTC, atau minta analisis singkat...",
  "dashboard.quickAsk.processing": "ORACLE sedang memproses permintaan...",

  // ------------------------------------------------------------------ //
  // Pemindai
  // ------------------------------------------------------------------ //
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

  // Peringatan risiko
  "scanner.risk.title": "Peringatan Risiko — Bukan Nasihat Keuangan",
  "scanner.risk.bodyBefore": "Sinyal di halaman ini dihasilkan aturan teknikal deterministik yang",
  "scanner.risk.bodyStrong": "belum diuji terhadap data historis",
  "scanner.risk.bodyAfter":
    ". Tidak ada probabilitas terkalibrasi, tidak ada jaminan akurasi, dan tidak ada proyeksi keuntungan. Perdagangan aset kripto berisiko tinggi dan dapat mengakibatkan kehilangan seluruh modal. Keputusan transaksi sepenuhnya menjadi tanggung jawab Anda. ORACLE tidak memberikan rekomendasi investasi.",

  // Kartu aset
  "scanner.card.criteriaMet": "Kriteria terpenuhi",
  "scanner.card.noCriteria": "Tidak ada kriteria arah yang terpenuhi.",
  "scanner.card.trend": "Tren",
  "scanner.card.noSignal": "Tidak ada sinyal",
  "scanner.trend.bullish": "Bullish",
  "scanner.trend.bearish": "Bearish",
  "scanner.card.notCalculated":
    "Indikator tidak dihitung untuk aset ini. Tidak ada angka yang ditampilkan agar tidak menyesatkan.",
  "scanner.locked.title": "Sinyal Pro Alpha",
  "scanner.locked.subtitle": "Klik untuk upgrade — buka kunci",

  // Kriteria teknikal
  "scanner.criteria.ema20AboveEma50": "EMA20 di atas EMA50",
  "scanner.criteria.ema20BelowEma50": "EMA20 di bawah EMA50",
  "scanner.criteria.rsiBelowOverbought": "RSI di bawah 70",
  "scanner.criteria.rsiAboveOversold": "RSI di atas 30",
  "scanner.criteria.rsiAboveMidline": "RSI di atas 50",
  "scanner.criteria.rsiBelowMidline": "RSI di bawah 50",

  // Status aset
  "scanner.assetStatus.ok": "Terkini",
  "scanner.assetStatus.stale": "Tertunda",
  "scanner.assetStatus.pending": "Menunggu",
  "scanner.assetStatus.unavailable": "Tidak tersedia",
  "scanner.assetStatus.insufficientHistory": "Riwayat kurang",
  "scanner.assetStatus.blocked": "Dihentikan",
  "scanner.assetStatus.unknownSymbol": "Tidak dikenal",
  "scanner.assetDetail.ok": "",
  "scanner.assetDetail.stale": "Harga terakhir sudah lewat beberapa saat.",
  "scanner.assetDetail.pending": "Indikator belum selesai dihitung.",
  "scanner.assetDetail.unavailable": "Data harga belum bisa diambil.",
  "scanner.assetDetail.insufficientHistory": "Candle belum cukup untuk indikator yang konvergen.",
  "scanner.assetDetail.blocked": "Perhitungan dibatalkan karena data harga bermasalah.",
  "scanner.assetDetail.unknownSymbol": "Aset tidak ada dalam daftar.",

  // Umur data
  "scanner.age.unknown": "—",
  "scanner.age.seconds": "{value} dtk lalu",
  "scanner.age.minutes": "{value} mnt lalu",
  "scanner.age.hours": "{value} jam lalu",

  // ------------------------------------------------------------------ //
  // Obrolan AI
  // ------------------------------------------------------------------ //
  "chat.eyebrow": "Terminal Oracle",
  "chat.title": "Ruang Kerja Analisis",
  "chat.proActive": "Pro Alpha Aktif",
  "chat.initialMessage":
    "Sistem ORACLE Online. Aset atau struktur pasar apa yang ingin Anda analisis hari ini?",
  "chat.placeholder": "Tanya struktur BTC, funding rate, atau lampirkan chart...",
  "chat.placeholderLocked": "Oracle AI terkunci...",
  "chat.processing": "Memproses data pasar...",
  "chat.proUnlimited": "PRO — Prompt FABLE 5 tanpa batas",
  "chat.quotaReached": "Batas gratis (0/{limit}) tercapai — Upgrade ke PRO ($49, USDC/USDT)",
  "chat.freePrompts": "Prompt Alpha Gratis:",
  "chat.upgrade": "Upgrade",
  "chat.locked.title": "Perlu Pro Alpha",
  "chat.locked.subtitle": "Klik untuk upgrade — Oracle AI + FABLE 5 tanpa batas",

  // ------------------------------------------------------------------ //
  // Intelijen Pasar
  // ------------------------------------------------------------------ //
  "intel.eyebrow": "Intelijen Pasar",
  "intel.title.pro": "Terminal Analitik",
  "intel.title.free": "Makro & On-Chain",
  "intel.liveFeed": "LANGSUNG · FEED PRO",
  "intel.alphaNews": "Feed Berita Alpha",
  "intel.preview": "(cuplikan)",
  "intel.noHeadlines": "Belum ada headline.",
  "intel.onchainStream": "oracle@onchain — stream",
  "intel.awaitingWhale": "> menunggu aliran whale (> $250rb)",
  "intel.macroEvents": "Peristiwa Makro & Pemerintah",
  "intel.macroSub": "US CPI · The Fed · NFP · ECB · global",
  "intel.paywall.title": "Upgrade ke PRO untuk Real-Time Alpha Feed & Deep On-Chain Stream",
  "intel.paywall.body":
    "Berita CryptoCompare / RSS langsung dengan thumbnail & tag sentimen, terminal whale-alert on-chain real-time (> $500rb), dan Kalender Ekonomi Makro (US CPI, The Fed, NFP). FREE hanya melihat cuplikan berita.",
  "intel.paywall.cta": "Upgrade ke PRO — $49/bln (USDC/USDT)",

  // ------------------------------------------------------------------ //
  // Jurnal
  // ------------------------------------------------------------------ //
  "journal.eyebrow": "Jurnal",
  "journal.title": "Jurnal Trading",
  "journal.newJournal": "Jurnal Baru",
  "journal.newJournalTitle": "Buat catatan jurnal manual (bukan membuka posisi pasar)",
  "journal.ledgerTitle": "Buku Transaksi — Mesin ORACLE",
  "journal.liveRefresh": "Langsung · segarkan otomatis 3 dtk",
  "journal.totalEquity": "Total Ekuitas (Kekayaan Bersih)",
  "journal.floatingPnl": "PnL Mengambang",
  "journal.virtualBalance": "Saldo Virtual",
  "journal.openPositions": "Posisi Terbuka",
  "journal.calculating": "menghitung…",
  "journal.closePosition": "Tutup",
  "journal.emptyLedger": "Belum ada trade dieksekusi. Buka proposal dari AI Chat atau Scanner.",
  "journal.table.time": "Waktu",
  "journal.table.asset": "Aset",
  "journal.table.side": "Sisi",
  "journal.table.mode": "Mode",
  "journal.table.entry": "Masuk",
  "journal.table.current": "Saat Ini",
  "journal.table.slTp": "SL / TP",
  "journal.table.size": "Ukuran",
  "journal.table.margin": "Margin",
  "journal.table.status": "Status",
  "journal.table.pnl": "PnL / Mengambang (RoE)",
  "journal.manual.title": "Jurnal Manual",
  "journal.manual.date": "Tanggal",
  "journal.manual.assetPair": "Pasangan Aset",
  "journal.manual.position": "Posisi",
  "journal.manual.pnlResult": "Hasil PnL",
  "journal.manual.notes": "Catatan",
  "journal.manual.empty":
    'Belum ada trade tercatat. Klik "Jurnal Baru" untuk mencatat trade pertama Anda.',
  "journal.manual.viewDetails": "Klik untuk melihat detail lengkap",
  "journal.form.pnlPercent": "PnL % (pakai + atau -)",
  "journal.form.notesLabel": "Catatan & Pelajaran Trade",
  "journal.form.assetPlaceholder": "mis. BTC/USDT",
  "journal.form.pnlPlaceholder": "mis. +5,5% atau -2,1%",
  "journal.form.notesPlaceholder": "Kenapa Anda mengambil trade ini?",
  "journal.details.title": "Detail Trade",
  "journal.details.edit": "Ubah Entri",
  "journal.delete.title": "Hapus Entri Jurnal",
  "journal.delete.warning": "Tindakan ini tidak bisa dibatalkan.",

  // ------------------------------------------------------------------ //
  // Pengaturan
  // ------------------------------------------------------------------ //
  "settings.eyebrow": "Pengaturan",
  "settings.title": "Konfigurasi Ruang Kerja",
  "settings.exchangeConnectivity": "Konektivitas Bursa",
  "settings.primaryExchange": "Bursa Utama",
  "settings.tradingEnvironment": "Lingkungan Trading",
  "settings.spotMarket": "Pasar Spot",
  "settings.perpetualFutures": "Futures Perpetual",
  "settings.apiKeysSecurity": "Kunci API & Keamanan",
  "settings.openAiLabel": "Mesin AI ORACLE (Kunci OpenAI)",
  "settings.credentials.title": "Kredensial Auto-Trade {exchange}",
  "settings.credentials.ready": "Auto-Trade Siap",
  "settings.credentials.missing": "Kurang: {fields}",
  "settings.credentials.helpBefore": "Ketiga kunci di bawah ini",
  "settings.credentials.helpStrong": "diperlukan untuk Auto-Trade",
  "settings.credentials.helpAfter":
    "menggunakan akun bursa Anda sendiri. Tanpa kunci lengkap, ORACLE hanya bisa menjalankan Paper Trading dan dry-run.",
  "settings.apiKey": "Kunci API Bursa",
  "settings.secretKey": "Kunci Rahasia Bursa",
  "settings.passphrase": "Passphrase Bursa (khusus OKX/KuCoin)",
  "settings.passphraseRequired": "— wajib untuk {exchange}",
  "settings.apiKeyPlaceholder": "Masukkan Kunci API",
  "settings.secretKeyPlaceholder": "Masukkan Kunci Rahasia",
  "settings.passphraseRequiredPlaceholder": "Wajib diisi untuk bursa ini",
  "settings.passphraseOptionalPlaceholder": "Kosongkan jika bursa Anda tidak memakainya",
  "settings.field.apiKey": "Kunci API",
  "settings.field.secretKey": "Kunci Rahasia",
  "settings.field.passphrase": "Passphrase",
  "settings.security.strong": "Non-custodial:",
  "settings.security.body":
    "kunci disimpan di local storage browser Anda dan tidak pernah masuk database ORACLE. Kunci hanya dikirim ke server saat Anda menekan tombol eksekusi, dipakai sekali untuk memanggil bursa, lalu dibuang.",
  "settings.warning.body":
    "Buat kunci API bursa dengan izin {trade} — {withdraw} dan aktifkan IP whitelist bila tersedia. Siapa pun yang mengakses browser ini bisa membaca local storage, jadi jangan memakai kunci berizin penarikan dana.",
  "settings.warning.trade": "Trade saja",
  "settings.warning.withdraw": "matikan Withdraw",
  "settings.save": "Simpan Konfigurasi",
  "settings.saved": "Konfigurasi Tersimpan!",

  // ------------------------------------------------------------------ //
  // Modal Upgrade PRO (billing)
  // ------------------------------------------------------------------ //
  "billing.title": "Upgrade ke ORACLE PRO",
  "billing.period": "/ bulan · {days} hari",
  "billing.later": "Nanti",
  "billing.preparing": "Menyiapkan…",
  "billing.payCta": "Bayar ${price} via Crypto (USDC/USDT)",
  "billing.multiChain": "Bayar stablecoin multi-chain:",
  "billing.benefit.prompts": "Prompt FABLE 5 tanpa batas (dengan Trader's Take yang bisa dieksekusi)",
  "billing.benefit.strategy":
    "Strategi mendalam & Trader's Take yang bisa dieksekusi (bukan sekadar data)",
  "billing.benefit.intel":
    "Intelijen Pasar Real-Time (berita CryptoCompare langsung, Kalender Ekonomi Makro, & Terminal Whale)",
  "billing.benefit.quant": "Prioritas model quant Opus (claude-opus-5)",
  "billing.benefit.scanner": "Notifikasi Pemindai Sinyal Langsung",
  "billing.benefit.autotrade": "Mesin Auto-Trade (paper + guardrail live)",
  "billing.toast.sandbox": "Mode sandbox — checkout simulasi",
  "billing.toast.opening": "Membuka checkout Coinbase…",
  "billing.toast.failed": "Gagal membuat charge",

  // ------------------------------------------------------------------ //
  // FAQ (halaman Settings)
  // ------------------------------------------------------------------ //
  "faq.title": "Pertanyaan yang Sering Diajukan",
  "faq.subtitle": "Langkah awal memakai ORACLE dan kunci bursa Anda.",
  "faq.q1": "Apa itu ORACLE?",
  "faq.a1":
    "ORACLE adalah terminal trading kripto berbasis AI non-custodial. Kami menggunakan model AI tingkat lanjut untuk memberikan sinyal probabilitas tinggi dan mengeksekusi trade secara otomatis.",
  "faq.q2": "Bagaimana cara membuat API Key di CEX?",
  "faq.a2":
    'Masuk ke akun bursa Anda (Binance, OKX, Bybit, dll), cari menu "API Management", dan buat kunci baru. Pastikan Anda MENGAKTIFKAN izin "Spot Trading" dan MEMATIKAN izin "Withdrawal" demi keamanan.',
  "faq.q3": "Bagaimana cara menyambungkan API ke ORACLE?",
  "faq.a3":
    "Salin API Key dan Secret Key dari bursa Anda, lalu tempelkan di kolom pengaturan Workspace di atas. Kunci Anda akan disimpan dengan aman di local storage browser Anda.",
  "faq.q4": "Apakah API Key saya aman di ORACLE?",
  "faq.a4":
    "Sangat aman. ORACLE menggunakan arsitektur non-custodial. Kunci rahasia Anda hanya disimpan secara aman di dalam browser Anda (Local Storage) dan tidak pernah disimpan di database server kami \u2014 kunci hanya dikirim saat Anda mengeksekusi trade, dipakai sekali untuk mengirim order ke bursa Anda, lalu dibuang.",

  // ------------------------------------------------------------------ //
  // Onboarding: cara trading di ORACLE
  // ------------------------------------------------------------------ //
  "onboarding.title": "Cara trading di ORACLE",
  "onboarding.subtitle": "Tiga langkah dari kunci API sampai eksekusi.",
  "onboarding.dismiss": "Tutup",
  "onboarding.step1.title": "Hubungkan Bursa",
  "onboarding.step1.desc": "Hubungkan kunci API Exchange/CEX Anda dengan aman di Pengaturan.",
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
