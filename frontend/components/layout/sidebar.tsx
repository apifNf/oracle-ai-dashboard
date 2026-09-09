"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Bot, Gauge, MessageSquareText, NotebookPen, Settings, Globe, User, LogOut, Activity, CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

// Label disimpan sebagai kunci kamus, bukan teks jadi — supaya bahasa bisa
// berganti tanpa remount sidebar.
const navItems: { href: string; labelKey: TranslationKey; icon: any; protected: boolean }[] = [
  { href: "/", labelKey: "nav.dashboard", icon: Gauge, protected: true },
  { href: "/scanner", labelKey: "nav.scanner", icon: Bot, protected: true },
  { href: "/ai-chat", labelKey: "nav.aiChat", icon: MessageSquareText, protected: true },
  { href: "/market-intelligence", labelKey: "nav.marketIntelligence", icon: Globe, protected: false },
  { href: "/journal", labelKey: "nav.journal", icon: NotebookPen, protected: true },
  { href: "/technical-analyst", labelKey: "nav.technicalAnalyst", icon: CandlestickChart, protected: true },
  { href: "/settings", labelKey: "nav.settings", icon: Settings, protected: true }
];

export function Sidebar() {
  const t = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [tier, setTier] = useState<'free' | 'pro' | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Tier dinamis dari backend ORACLE billing (Coinbase Commerce provisioning).
  const syncTierFromBackend = async (email: string | null | undefined) => {
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
      const res = await fetch(
        `${base}/api/v1/billing/status?user_id=${encodeURIComponent(email || "default")}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.tier) setTier(data.tier === "pro" ? "pro" : "free");
      }
    } catch {
      /* biarkan fallback Supabase */
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);

      if (session?.user) {
        const { data } = await supabase
          .from('user_quotas')
          .select('tier')
          .eq('id', session.user.id)
          .single();
        setTier(data?.tier ?? 'free');
      }
      await syncTierFromBackend(session?.user?.email);
      setIsLoading(false);
    };

    initAuth();
    const poll = setInterval(() => {
      supabase.auth.getSession().then(({ data: { session } }) => syncTierFromBackend(session?.user?.email));
    }, 15000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setTier(null);
      else syncTierFromBackend(session.user.email);
    });

    return () => {
      clearInterval(poll);
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>, isProtected: boolean) => {
    if (isProtected && !user && !isLoading) {
      e.preventDefault();
      setShowModal(true);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <aside className="border-b border-slate-200 bg-white/80 dark:border-white/10 dark:bg-[#0A0A0A]/80 px-4 py-3 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex md:flex-col md:border-b-0 md:border-r md:p-5 transition-colors duration-500 z-40">
        <div className="flex items-center justify-between md:block">
          <Link href="/" className="text-xl font-semibold tracking-wide text-slate-900 dark:text-zinc-50 transition-colors duration-500">
            ORACLE
          </Link>
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-400 md:mt-1 md:block transition-colors duration-500">
            {t("sidebar.subtitle")}
          </span>
        </div>
        
        <nav className="mt-4 flex gap-2 overflow-x-auto md:mt-8 md:block md:space-y-1 flex-1">
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => handleNavigation(e, item.protected)}
                className={cn(
                  "flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-300",
                  isActive 
                    ? "bg-slate-100 text-emerald-600 dark:bg-white/10 dark:text-emerald-400 font-medium" 
                    : "text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="hidden md:flex mt-auto pt-4 border-t border-slate-200 dark:border-white/10 items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 shrink-0">
                <User className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-200 truncate w-[100px]">
                  {user.email}
                </span>
                {tier === 'pro' ? (
                  <span
                    className="mt-0.5 inline-flex items-center gap-1 self-start rounded px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase transition-colors
                      text-emerald-700 bg-emerald-500/10 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.25)]
                      dark:text-amber-300 dark:bg-gradient-to-r dark:from-emerald-500/15 dark:to-amber-500/15 dark:border-amber-400/40 dark:shadow-[0_0_12px_rgba(245,158,11,0.35)]"
                  >
                    <span className="w-1 h-1 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                    {t("sidebar.proTier")}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold tracking-widest uppercase mt-0.5 text-slate-500 dark:text-zinc-500">
                    {t("sidebar.freeTier")}
                  </span>
                )}
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all shrink-0"
              title={t("sidebar.signOut")}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-[380px] p-8 border rounded-2xl bg-[#0A0A0A] border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[2px] bg-emerald-500/50 rounded-b-full shadow-[0_0_15px_rgba(16,185,129,0.5)]"></div>
            
            <div className="flex flex-col items-center text-center space-y-5">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <Activity className="w-6 h-6 text-emerald-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white tracking-tight">{t("auth.title")}</h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {t("auth.description")}
                </p>
              </div>
              <div className="pt-4 w-full flex gap-3">
                <button 
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-500 hover:text-white transition-colors"
                >
                  {t("auth.cancel")}
                </button>
                <button 
                  onClick={() => {
                    setShowModal(false);
                    router.push('/login');
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-900 bg-zinc-200 hover:bg-white rounded-lg transition-colors flex items-center justify-center"
                >
                  {t("auth.continue")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}