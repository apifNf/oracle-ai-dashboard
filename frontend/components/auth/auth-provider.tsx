// components/auth/auth-provider.tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { LogOut, User, Zap } from "lucide-react";

type AuthContextType = {
  user: any;
  tier: 'free' | 'pro' | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({ user: null, tier: null, signOut: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [tier, setTier] = useState<'free' | 'pro' | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setTier(null);
      if (event === 'SIGNED_IN') {
        setShowAuthModal(false);
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      
      if (!link) return;
      
      const href = link.getAttribute('href');
      if (!href) return;

      const protectedRoutes = ['/dashboard', '/scanner', '/ai-chat', '/journal', '/settings'];
      const isProtected = protectedRoutes.some(route => href.startsWith(route));

      if (isProtected && !user) {
        e.preventDefault();
        e.stopPropagation();
        setShowAuthModal(true);
      }
    };

    window.addEventListener('click', handleGlobalClick, true);
    return () => window.removeEventListener('click', handleGlobalClick, true);
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <AuthContext.Provider value={{ user, tier, signOut }}>
      {children}
      
      {user && <ProfileWidget user={user} tier={tier} signOut={signOut} />}
      
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md p-8 border rounded-2xl bg-zinc-950 border-zinc-800 shadow-2xl">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Zap className="w-6 h-6 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Authentication Required</h2>
              <p className="text-sm text-zinc-400">
                ORACLE Core requires an active session to access this module. Please authenticate to continue.
              </p>
              <div className="pt-4 w-full flex gap-3">
                <button 
                  onClick={() => setShowAuthModal(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowAuthModal(false);
                    router.push('/login');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-semibold text-zinc-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors"
                >
                  Login / Enter Email
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

function ProfileWidget({ user, tier, signOut }: { user: any, tier: string | null, signOut: () => void }) {
  return (
    <div className="fixed bottom-6 left-6 z-50 flex items-center justify-between w-[240px] p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 backdrop-blur-md shadow-lg">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0">
          <User className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span className="text-xs font-medium text-zinc-200 truncate w-[120px]">
            {user.email}
          </span>
          <span className={`text-[10px] font-bold tracking-widest uppercase mt-0.5 ${tier === 'pro' ? 'text-amber-400' : 'text-zinc-500'}`}>
            {tier === 'pro' ? 'PRO ALPHA' : 'FREE TIER'}
          </span>
        </div>
      </div>
      <button 
        onClick={signOut}
        className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
        title="Secure Sign Out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

export const useAuth = () => useContext(AuthContext);