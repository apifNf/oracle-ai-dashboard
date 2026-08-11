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
      <div>
        <p className="text-sm uppercase tracking-[0.24em] text-zinc-400">AI Chat</p>
        <h1 className="mt-2 text-3xl font-semibold flex items-center gap-3">
          <Brain className="w-8 h-8 text-emerald-500" /> Analysis Workspace
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto mt-6 mb-4 space-y-6 pr-4 custom-scrollbar">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "oracle" && <div className="w-8 h-8 rounded-full bg-emerald-900/50 border border-emerald-500/30 flex items-center justify-center flex-shrink-0"><Brain className="w-4 h-4 text-emerald-500" /></div>}
            <div className={`p-4 rounded-2xl max-w-[85%] whitespace-pre-wrap text-sm leading-relaxed ${msg.role === "user" ? "bg-zinc-800 text-white rounded-br-none" : "bg-[#09090b] border border-zinc-800 text-zinc-300 rounded-bl-none"}`}>
              {msg.content}
            </div>
            {msg.role === "user" && <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0"><User className="w-4 h-4 text-zinc-400" /></div>}
          </div>
        ))}
        {loading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-900/50 flex items-center justify-center animate-pulse"><Brain className="w-4 h-4 text-emerald-500" /></div>
            <div className="p-4 rounded-2xl bg-[#09090b] border border-zinc-800 text-zinc-500 text-sm">Processing market data...</div>
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="relative mt-auto">
        <input 
          type="text" 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)} 
          placeholder="Ask about BTC structure, funding rates, or macro events..." 
          className="w-full bg-[#09090b] border border-zinc-800 rounded-xl py-4 pl-4 pr-14 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !prompt.trim()} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 rounded-lg text-white disabled:opacity-50 hover:bg-emerald-500 transition-colors">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}