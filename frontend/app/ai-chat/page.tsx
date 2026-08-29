"use client";

import { useState, useRef, useEffect } from "react";
import { Brain, Send, User, Radar, Paperclip, Activity, X, ImageIcon, Lock, Zap } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";

type Message = { 
  role: "user" | "oracle" | "system"; 
  content: string;
  symbols?: string[];
  contextInjected?: boolean;
  imageUrl?: string;
};

export default function AiChatPage() {
  const { tier } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    { role: "oracle", content: "ORACLE System Online. What asset or market structure would you like to analyze today?" }
  ]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const FREE_PROMPT_LIMIT = 3;
  const userMessageCount = messages.filter(m => m.role === "user").length;
  const isLocked = tier !== 'pro' && userMessageCount >= FREE_PROMPT_LIMIT;
  const remainingPrompts = Math.max(0, FREE_PROMPT_LIMIT - userMessageCount);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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
      let res;
      let data;

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
        res = await fetch(`${API_BASE_URL}/api/v1/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: currentPrompt }),
        });
        data = await res.json();
        
        setMessages((prev) => [...prev, { 
          role: "oracle", 
          content: data.reply || data.response || "Analysis complete.",
          symbols: data.detected_symbols,
          contextInjected: data.context_injected
        }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "system", content: "Connection error to ORACLE Core." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto px-4 relative">
      <div className="py-6 border-b border-slate-200 dark:border-zinc-800/50 mb-4 sticky top-0 z-10 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md">
        <p className="text-xs uppercase tracking-[0.3em] font-bold text-emerald-500 mb-2 flex items-center gap-2">
          <Activity className="w-4 h-4 animate-pulse" /> Oracle Terminal
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
            Analysis Workspace
          </h1>
          {tier === 'pro' && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-500">
                Pro Alpha Active
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
                {msg.content}
              </div>
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
              <span className="text-sm text-slate-500 dark:text-zinc-400 font-medium">Processing market data...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="absolute bottom-6 left-4 right-4 md:left-8 md:right-8 flex flex-col gap-2">
        {tier !== 'pro' && !isLocked && (
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">
            <Activity className="w-3.5 h-3.5" />
            <span>Free Alpha Prompts Remaining: <strong className="text-emerald-500">{remainingPrompts}/{FREE_PROMPT_LIMIT}</strong></span>
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
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-[#0A0A0A]/70 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-white/10 shadow-lg">
              <div className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-[#111113] rounded-xl border border-amber-500/30 shadow-2xl">
                <Lock className="w-5 h-5 text-amber-500" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white uppercase">Pro Alpha Required</span>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400">Upgrade to unlock unlimited Oracle AI Analysis</span>
                </div>
              </div>
            </div>
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
              placeholder={isLocked ? "Oracle AI is locked..." : "Ask about BTC structure, funding rates, or attach a chart..."}
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
    </div>
  );
}