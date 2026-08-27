"use client";

import { useState, useRef, useEffect } from "react";
import { Brain, Send, User, Radar, Paperclip, Activity, X, ImageIcon } from "lucide-react";

// 1. Upgrade tipe Message untuk menampung URL Gambar
type Message = { 
  role: "user" | "oracle" | "system"; 
  content: string;
  symbols?: string[];
  contextInjected?: boolean;
  imageUrl?: string; // Menyimpan gambar di dalam bubble chat
};

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "oracle", content: "ORACLE System Online. What asset or market structure would you like to analyze today?" }
  ]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

  const handleAttachmentClick = () => {
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
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() && !selectedImage) return;

    // 2. Simpan URL gambar ke dalam history chat User sebelum state dibersihkan
    const currentImage = selectedImage;
    const currentPreview = imagePreview;
    const currentPrompt = prompt || "Tolong analisa gambar ini";

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

      // 3. LOGIC PERCABANGAN KONDISI (TEKS vs GAMBAR)
      if (currentImage) {
        // Jika ada gambar, gunakan FormData dan tembak ke endpoint /vision
        const formData = new FormData();
        formData.append("file", currentImage);
        
        res = await fetch(`${API_BASE_URL}/api/v1/chat/vision`, {
          method: "POST",
          body: formData,
        });
        data = await res.json();

        setMessages((prev) => [...prev, { 
          role: "oracle", 
          // Menyesuaikan dengan response JSON dari backend /vision kita
          content: data.message || data.reply || "Image analysis complete."
        }]);

      } else {
        // Jika hanya teks, tembak ke endpoint /chat biasa
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
      {/* HEADER */}
      <div className="py-6 border-b border-slate-200 dark:border-zinc-800/50 mb-4 sticky top-0 z-10 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md">
        <p className="text-xs uppercase tracking-[0.3em] font-bold text-emerald-500 mb-2 flex items-center gap-2">
          <Activity className="w-4 h-4 animate-pulse" /> Oracle Terminal
        </p>
        <h1 className="text-3xl font-semibold flex items-center gap-3 text-slate-900 dark:text-zinc-50">
          Analysis Workspace
        </h1>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 overflow-y-auto space-y-8 pr-2 pb-40 custom-scrollbar">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            
            {/* Avatar AI */}
            {msg.role !== "user" && (
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg ${
                msg.role === "oracle" ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/30"
              }`}>
                <Brain className={`w-5 h-5 ${msg.role === "oracle" ? "text-emerald-500" : "text-red-500"}`} />
              </div>
            )}
            
            <div className={`flex flex-col gap-2 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {/* Radar Badge */}
              {msg.contextInjected && msg.symbols && msg.symbols.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-100/50 dark:bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20 shadow-sm">
                  <Radar className="w-3 h-3 animate-spin-slow" />
                  Live Market Data Injected: {msg.symbols.join(", ")}
                </div>
              )}

              {/* BUBBLE CHAT */}
              <div className={`p-5 rounded-2xl whitespace-pre-wrap text-[15px] leading-relaxed shadow-sm transition-all ${
                msg.role === "user" 
                  ? "bg-gradient-to-br from-slate-800 to-slate-900 text-white dark:from-zinc-800 dark:to-zinc-900 rounded-br-none border border-slate-700/50" 
                  : msg.role === "system"
                  ? "bg-red-50/50 border border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 rounded-bl-none"
                  : "bg-white border border-slate-200 text-slate-700 dark:bg-[#111113] dark:border-zinc-800 dark:text-zinc-300 rounded-bl-none"
              }`}>
                
                {/* 4. MERENDER GAMBAR DI DALAM BUBBLE CHAT USER */}
                {msg.imageUrl && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-white/10 shadow-inner bg-black/20">
                    <img 
                      src={msg.imageUrl} 
                      alt="User uploaded chart" 
                      className="max-w-full md:max-w-md h-auto object-cover"
                    />
                  </div>
                )}
                
                {msg.content}
              </div>
            </div>

            {/* Avatar User */}
            {msg.role === "user" && (
              <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 shadow-md">
                <User className="w-5 h-5 text-slate-500 dark:text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {/* Loading State */}
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
              <span className="text-sm text-slate-500 dark:text-zinc-400 font-medium">Processing visual data...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="absolute bottom-6 left-4 right-4 md:left-8 md:right-8 flex flex-col gap-2">
        
        {imagePreview && (
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

        <form onSubmit={sendMessage} className="relative flex items-center bg-white/80 dark:bg-[#18181b]/80 backdrop-blur-xl border border-slate-300/80 dark:border-zinc-700/80 rounded-2xl p-2 shadow-xl dark:shadow-2xl dark:shadow-black/50">
          
          <input 
            type="file" 
            accept="image/*" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
          />

          <button 
            type="button" 
            onClick={handleAttachmentClick}
            className={`p-3 transition-colors ${imagePreview ? 'text-emerald-500' : 'text-slate-400 hover:text-emerald-500'}`}
          >
            {imagePreview ? <ImageIcon className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
          </button>

          <input 
            type="text" 
            value={prompt} 
            onChange={(e) => setPrompt(e.target.value)} 
            placeholder="Ask about BTC structure, funding rates, or attach a chart..." 
            className="flex-1 bg-transparent border-none py-3 px-2 text-[15px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0 dark:text-white dark:placeholder:text-zinc-500"
            disabled={loading}
          />
          
          <button 
            type="submit" 
            disabled={loading || (!prompt.trim() && !selectedImage)} 
            className="p-3 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-white disabled:opacity-50 disabled:hover:bg-emerald-500 transition-all shadow-md ml-2 flex items-center justify-center"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}