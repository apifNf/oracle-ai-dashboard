"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, User, Radar, Paperclip, Activity, X, ImageIcon, Lock, Zap, Crown } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";
import { formatFable5Decision } from "@/lib/fable5";
import { TradeProposalTicket } from "@/components/trade/trade-proposal-ticket";
import { proposalParamsFromDecision, extractProposalFromText, type ProposalParams } from "@/lib/trade";
import { useAccountId, getAccountIdNow, fetchBillingStatus, type BillingStatus } from "@/lib/billing";
import { useTranslation } from "@/lib/i18n/context";
import { UpgradeToProModal } from "@/components/billing/upgrade-to-pro-modal";
import { useToasts, ToastViewport } from "@/components/ui/toast";

type Message = {
  role: "user" | "oracle" | "system";
  content: string;
  symbols?: string[];
  contextInjected?: boolean;
  imageUrl?: string;
  decision?: any;
  proposalParams?: ProposalParams | null;
};

// Pesan pembuka disimpan sebagai SENTINEL, bukan teks jadi: kalau teksnya
// dibekukan saat mount, mengganti bahasa tidak akan mengubahnya. Diterjemahkan
// saat render.
const INITIAL_MESSAGE_KEY = "__oracle_initial_message__";

export default function AiChatPage() {
  const t = useTranslation();
  const { accountId, email } = useAccountId();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [messages, setMessages] = useState<Message[]>([
    { role: "oracle", content: INITIAL_MESSAGE_KEY }
  ]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const tier: "free" | "pro" = billing?.tier ?? "free";
  const remainingPrompts = billing?.prompts_remaining ?? null; // null = unlimited (pro)
  const isLocked = tier === "free" && remainingPrompts !== null && remainingPrompts <= 0;

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

  const refreshBilling = useCallback(async () => {
    if (!accountId) return;
    const s = await fetchBillingStatus(accountId);
    if (s) setBilling(s);
  }, [accountId]);

  useEffect(() => {
    refreshBilling();
  }, [refreshBilling]);

  // Kembali dari checkout (?upgraded=1) -> refresh & sambut.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("upgraded") === "1") {
      refreshBilling().then(() => pushToast("success", "Selamat! Akun kamu sekarang PRO", "Prompt tak terbatas + FABLE 5 prioritas."));
      window.history.replaceState({}, "", "/ai-chat");
    } else if (p.get("upgrade") === "cancelled") {
      pushToast("info", "Upgrade dibatalkan");
      window.history.replaceState({}, "", "/ai-chat");
    }
  }, [refreshBilling, pushToast]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleAttachmentClick = () => {
    if (isLocked) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked || (!prompt.trim() && !selectedImage)) return;

    const currentImage = selectedImage;
    const currentPreview = imagePreview;
    const currentPrompt = prompt || "Analyze this chart structure.";

    const newMessages: Message[] = [...messages, { 
      role: "user", 
      content: currentPrompt,
      imageUrl: currentPreview || undefined 
    }];
    
    setMessages(newMessages);
    setPrompt("");
    setSelectedImage(null);
    setImagePreview(null);
    setLoading(true);

    try {
      let res: Response;
      let data: any;

      if (currentImage) {
        const formData = new FormData();
        formData.append("file", currentImage);
        
        res = await fetch(`${API_BASE_URL}/api/v1/chat/vision`, {
          method: "POST",
          body: formData,
        });
        data = await res.json();

        setMessages((prev) => [...prev, { 
          role: "oracle", 
          content: data.message || data.reply || "Visual analysis complete."
        }]);
      } else {
        // Resolusi account id FRESH saat kirim — jangan andalkan state yang
        // mungkin belum sinkron (sumber bug tier PRO -> FREE).
        const { accountId: uid, email: mail } = await getAccountIdNow();

        // AI Router lokal: TIER 1 (GPT-4o) -> data.reply,
        // TIER 2 (FABLE 5 / Claude) -> data.decision (JSON keputusan kuant).
        res = await fetch(`${API_BASE_URL}/api/v1/ai/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: currentPrompt,
            account_id: uid,
            user_id: uid,
            email: mail,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();

        // Selaraskan tier lokal dengan yang dilaporkan backend.
        if (data.user_tier && data.user_tier !== (billing?.tier ?? "free")) {
          refreshBilling();
        }

        // Sinkron kuota dari respons.
        if (data.quota) {
          setBilling((b) =>
            b
              ? { ...b, prompts_used_today: data.quota.used, prompts_remaining: data.quota.remaining, tier: data.user_tier ?? b.tier }
              : b,
          );
        }
        if (data.limit_reached) {
          setMessages((prev) => [...prev, { role: "system", content: data.reply || "Batas prompt harian tercapai." }]);
          setUpgradeOpen(true);
          return;
        }

        const rawContent =
          (typeof data.reply === "string" && data.reply.trim()) ||
          (data.decision ? formatFable5Decision(data.decision) : "") ||
          "Analysis complete.";

        // Deteksi blok @@ORACLE_PROPOSAL@@ di akhir respons -> render ticket.
        const { params: textParams, cleanedText } = extractProposalFromText(rawContent, accountId);

        setMessages((prev) => [...prev, {
          role: "oracle",
          content: cleanedText || rawContent,
          symbols: data.detected_symbol ? [data.detected_symbol] : undefined,
          contextInjected: Boolean(data.metrics_used) || Boolean(data.decision),
          decision: data.decision,
          proposalParams: textParams,
        }]);
      }
    } catch (err) {
      console.error("AI Router error:", err);
      setMessages((prev) => [...prev, { role: "system", content: "Connection error to ORACLE Core." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto px-4 relative">
      <div className="py-6 border-b border-slate-200 dark:border-zinc-800/50 mb-4 sticky top-0 z-10 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md">
        <p className="text-xs uppercase tracking-[0.3em] font-bold text-emerald-500 mb-2 flex items-center gap-2">
          <Activity className="w-4 h-4 animate-pulse" /> {t("chat.eyebrow")}
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            {t("chat.title")}
          </h1>
          {tier === 'pro' && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
                {t("chat.proActive")}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-8 pr-2 pb-40 custom-scrollbar">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role !== "user" && (
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg",
                msg.role === "oracle" ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/30"
              )}>
                <Brain className={cn("w-5 h-5", msg.role === "oracle" ? "text-emerald-500" : "text-red-500")} />
              </div>
            )}
            
            <div className={`flex flex-col gap-2 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {msg.contextInjected && msg.symbols && msg.symbols.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-100/50 dark:bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20 shadow-sm">
                  <Radar className="w-3 h-3 animate-spin-slow" />
                  Live Market Data Injected: {msg.symbols.join(", ")}
                </div>
              )}

              <div className={cn(
                "p-5 rounded-2xl whitespace-pre-wrap text-[15px] leading-relaxed shadow-sm transition-all",
                msg.role === "user" 
                  ? "bg-gradient-to-br from-slate-800 to-slate-900 text-white dark:from-zinc-800 dark:to-zinc-900 rounded-br-none border border-slate-700/50" 
                  : msg.role === "system"
                  ? "bg-red-50/50 border border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 rounded-bl-none"
                  : "bg-white border border-slate-200 text-slate-700 dark:bg-[#111113] dark:border-zinc-800 dark:text-zinc-300 rounded-bl-none"
              )}>
                {msg.imageUrl && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-white/10 shadow-inner bg-black/20">
                    <img 
                      src={msg.imageUrl} 
                      alt="Analysis visual context" 
                      className="max-w-full md:max-w-md h-auto object-cover"
                    />
                  </div>
                )}
                {msg.content === INITIAL_MESSAGE_KEY ? t("chat.initialMessage") : msg.content}
              </div>

              {(() => {
                const ticketParams =
                  (msg.decision && proposalParamsFromDecision(msg.decision, accountId)) ||
                  msg.proposalParams ||
                  null;
                return ticketParams ? (
                  <div className="w-full sm:min-w-[420px]">
                    <TradeProposalTicket params={ticketParams} />
                  </div>
                ) : null;
              })()}
            </div>

            {msg.role === "user" && (
              <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 shadow-md">
                <User className="w-5 h-5 text-slate-500 dark:text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Brain className="w-5 h-5 text-emerald-500 animate-pulse" />
            </div>
            <div className="p-5 rounded-2xl bg-white border border-slate-200 dark:bg-[#111113] dark:border-zinc-800 rounded-bl-none shadow-sm flex items-center gap-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
              <span className="text-sm text-slate-500 dark:text-zinc-400 font-medium">{t("chat.processing")}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="absolute bottom-6 left-4 right-4 md:left-8 md:right-8 flex flex-col gap-2">
        {tier === "pro" ? (
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-amber-500 mb-1">
            <Crown className="w-3.5 h-3.5" />
            <span>{t("chat.proUnlimited")}</span>
          </div>
        ) : isLocked ? (
          <button
            onClick={() => setUpgradeOpen(true)}
            className="mb-1 flex items-center justify-center gap-2 text-xs font-medium rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-1.5 hover:border-amber-400 transition-colors"
          >
            <Crown className="w-3.5 h-3.5" />
            {t("chat.quotaReached", { limit: billing?.prompt_limit ?? 3 })}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">
            <Activity className="w-3.5 h-3.5" />
            <span>
              {t("chat.freePrompts")}{" "}
              <strong className="text-emerald-500">
                {remainingPrompts ?? "—"}/{billing?.prompt_limit ?? 3}
              </strong>
            </span>
            <button
              onClick={() => setUpgradeOpen(true)}
              className="ml-1 text-amber-500 hover:text-amber-400 font-semibold"
            >
              {t("chat.upgrade")}
            </button>
          </div>
        )}

        {imagePreview && !isLocked && (
          <div className="self-start relative group rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 shadow-md bg-white dark:bg-[#18181b] p-1">
            <img src={imagePreview} alt="Preview" className="h-20 w-auto rounded-lg object-cover" />
            <button 
              type="button" 
              onClick={removeImage}
              className="absolute top-2 right-2 bg-black/60 hover:bg-black text-white p-1 rounded-full transition-colors backdrop-blur-sm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="relative">
          {isLocked && (
            <button
              onClick={() => setUpgradeOpen(true)}
              className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-[#0A0A0A]/70 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-white/10 shadow-lg cursor-pointer"
            >
              <div className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-[#111113] rounded-xl border border-amber-500/30 shadow-2xl">
                <Lock className="w-5 h-5 text-amber-500" />
                <div className="flex flex-col text-left">
                  <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white uppercase">{t("chat.locked.title")}</span>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400">{t("chat.locked.subtitle")}</span>
                </div>
              </div>
            </button>
          )}

          <form onSubmit={sendMessage} className={cn(
            "relative flex items-center bg-white/80 dark:bg-[#18181b]/80 backdrop-blur-xl border rounded-2xl p-2 shadow-xl transition-all duration-300",
            isLocked ? "border-slate-200 dark:border-zinc-800 opacity-50 pointer-events-none" : "border-slate-300/80 dark:border-zinc-700/80 dark:shadow-black/50"
          )}>
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              disabled={isLocked}
            />

            <button 
              type="button" 
              onClick={handleAttachmentClick}
              disabled={isLocked}
              className={`p-3 transition-colors ${imagePreview ? 'text-emerald-500' : 'text-slate-400 hover:text-emerald-500'}`}
            >
              {imagePreview ? <ImageIcon className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
            </button>

            <input 
              type="text" 
              value={prompt} 
              onChange={(e) => setPrompt(e.target.value)} 
              placeholder={isLocked ? t("chat.placeholderLocked") : t("chat.placeholder")}
              className="flex-1 bg-transparent border-none py-3 px-2 text-[15px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0 dark:text-white dark:placeholder:text-zinc-500"
              disabled={loading || isLocked}
            />
            
            <button 
              type="submit" 
              disabled={loading || isLocked || (!prompt.trim() && !selectedImage)} 
              className="p-3 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-white disabled:opacity-50 disabled:hover:bg-emerald-500 transition-all shadow-md ml-2 flex items-center justify-center"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>

      <UpgradeToProModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        accountId={accountId}
        email={email}
        onToast={pushToast}
      />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}