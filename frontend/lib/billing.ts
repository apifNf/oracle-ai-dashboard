// Client helpers untuk Billing / Monetisasi (Coinbase Commerce).

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export type BillingConfig = {
  price_usd: string;
  period_days: number;
  free_prompt_daily_limit: number;
  mock_mode: boolean;
  accepted_assets: string[];
  accepted_networks: string[];
};

export type BillingStatus = {
  user_id: string;
  tier: "free" | "pro";
  stored_tier: string;
  pro_expires_at: string | null;
  pro_expired: boolean;
  prompt_limit: number | null;
  prompts_used_today: number;
  prompts_remaining: number | null;
};

export type CreateChargeResult = {
  checkout_url: string;
  charge_id: string;
  code?: string;
  amount_usd: string;
  mock: boolean;
  accepted_assets: string[];
  accepted_networks: string[];
};

function _supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Account id KANONIK lintas halaman: email sesi Supabase, fallback "default".
 * Dipakai untuk billing status, gating AI Chat, dan Market Intelligence —
 * harus identik dengan yang dipakai saat upgrade + yang dibaca sidebar.
 */
export async function getAccountIdNow(): Promise<{ accountId: string; email: string | null }> {
  try {
    const { data } = await _supabase().auth.getSession();
    const email = data?.session?.user?.email ?? null;
    return { accountId: email || "default", email };
  } catch {
    return { accountId: "default", email: null };
  }
}

export function useAccountId(): { accountId: string; email: string | null; ready: boolean } {
  const [state, setState] = useState<{ accountId: string; email: string | null; ready: boolean }>({
    accountId: "default",
    email: null,
    ready: false,
  });

  useEffect(() => {
    let active = true;
    let sub: { unsubscribe: () => void } | null = null;

    const apply = (email: string | null) => {
      if (active) setState({ accountId: email || "default", email, ready: true });
    };

    try {
      const supabase = _supabase();
      // getSession() = baca cache lokal (instan), tidak menunggu roundtrip server.
      supabase.auth
        .getSession()
        .then(({ data }) => apply(data?.session?.user?.email ?? null))
        .catch(() => apply(null));
      sub = supabase.auth.onAuthStateChange((_e, session) =>
        apply(session?.user?.email ?? null),
      ).data.subscription;
    } catch {
      apply(null);
    }
    return () => {
      active = false;
      sub?.unsubscribe();
    };
  }, []);

  return state;
}

export async function fetchBillingConfig(): Promise<BillingConfig | null> {
  try {
    const r = await fetch(`${API_BASE}/api/v1/billing/config`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function fetchBillingStatus(userId: string): Promise<BillingStatus | null> {
  try {
    const r = await fetch(
      `${API_BASE}/api/v1/billing/status?user_id=${encodeURIComponent(userId)}`,
    );
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function createCharge(userId: string, email?: string | null): Promise<CreateChargeResult> {
  const r = await fetch(`${API_BASE}/api/v1/billing/create-charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, email: email ?? null }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
  return data;
}

/** Mock mode: simulasikan pembayaran sukses. */
export async function mockConfirmCharge(chargeId: string) {
  const r = await fetch(`${API_BASE}/api/v1/billing/mock-confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ charge_id: chargeId }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
  return data;
}
