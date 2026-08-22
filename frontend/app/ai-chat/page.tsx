"use client";

import { useState } from "react";
import { Brain, Send, User } from "lucide-react";

type Message = { role: "user" | "oracle"; content: string; };

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "oracle", content: "ORACLE System Online. What asset or market structure would you like to analyze today?" }
  ]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const newMessages: Message[] = [...messages, { role: "user", content: prompt }];
    setMessages(newMessages);
    setPrompt("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setMessages([...newMessages, { role: "oracle", content: data.reply || data.response || "Analysis complete." }]);
    } catch (err) {
      setMessages([...newMessages, { role: "oracle", content: "Connection error to ORACLE Core." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl">
      {/* HEADER */}
      <div>
        <p className="text-sm uppercase tracking-[0.24em] font-medium text-slate-500 dark:text-zinc-400 transition-colors">AI Chat</p>
        <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50 transition-colors">
          <Brain className="w-8 h-8 text-emerald-500" /> Analysis Workspace
        </h1>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 overflow-y-auto mt-6 mb-4 space-y-6 pr-4 custom-scrollbar">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            
            {/* Ikon Avatar AI */}
            {msg.role === "oracle" && (
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 dark:bg-emerald-900/50 dark:border-emerald-500/30 flex items-center justify-center flex-shrink-0 transition-colors">
                <Brain className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
              </div>
            )}
            
            {/* Bubble Chat */}
            <div className={`p-4 rounded-2xl max-w-[85%] whitespace-pre-wrap text-sm leading-relaxed transition-colors shadow-sm dark:shadow-none ${
              msg.role === "user" 
                ? "bg-slate-900 text-white dark:bg-zinc-800 dark:text-white rounded-br-none" 
                : "bg-white border border-slate-200 text-slate-700 dark:bg-[#09090b] dark:border-zinc-800 dark:text-zinc-300 rounded-bl-none"
            }`}>
              {msg.content}
            </div>

            {/* Ikon Avatar User */}
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 transition-colors">
                <User className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {/* Indikator Loading / Typing */}
        {loading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center animate-pulse transition-colors">
              <Brain className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
            </div>
            <div className="p-4 rounded-2xl bg-white border border-slate-200 text-slate-500 dark:bg-[#09090b] dark:border-zinc-800 dark:text-zinc-500 text-sm shadow-sm dark:shadow-none transition-colors">
              Processing market data...
            </div>
          </div>
        )}
      </div>

      {/* INPUT AREA */}
      <form onSubmit={sendMessage} className="relative mt-auto">
        <input 
          type="text" 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)} 
          placeholder="Ask about BTC structure, funding rates, or macro events..." 
          className="w-full bg-white border border-slate-300 rounded-xl py-4 pl-4 pr-14 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:bg-[#09090b] dark:border-zinc-800 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-500/50 dark:focus:ring-0 transition-all shadow-sm dark:shadow-none"
          disabled={loading}
        />
        <button 
          type="submit" 
          disabled={loading || !prompt.trim()} 
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 rounded-lg text-white disabled:opacity-50 hover:bg-emerald-500 transition-colors shadow-sm"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}