"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Activity, Mail, KeyRound, ArrowRight, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  
  const supabase = createClient();

  // Langkah 1: Kirim OTP ke Email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setLoading(true);
    setMessage({ text: "", type: "" });

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true, // Otomatis mendaftar jika belum punya akun
        },
      });

      if (error) throw error;

      setStep("otp");
      setMessage({ text: "Magic code sent! Check your inbox.", type: "success" });
    } catch (error: any) {
      setMessage({ text: error.message || "Failed to send code.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Langkah 2: Verifikasi OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;

    setLoading(true);
    setMessage({ text: "", type: "" });

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });

      if (error) throw error;

      if (data.session) {
        setMessage({ text: "Access granted. Initializing system...", type: "success" });
        // Redirect ke dashboard setelah 1 detik
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      }
    } catch (error: any) {
      setMessage({ text: "Invalid or expired magic code.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col justify-center relative overflow-hidden selection:bg-emerald-500/30">
      
      {/* Background Ornaments (Hacker/Enterprise vibe) */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-500/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/5 blur-[120px] rounded-full"></div>
        
        {/* Grid Pattern Premium */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      </div>

      <div className="max-w-md w-full mx-auto p-8 relative z-10">
        
        {/* Header Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#111113] border border-zinc-800 shadow-2xl mb-6 relative group">
            <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <Activity className="w-8 h-8 text-emerald-500 relative z-10" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">ORACLE Core</h1>
          <p className="text-zinc-400 text-sm">Institutional Crypto Intelligence</p>
        </div>

        {/* Auth Card */}
        <div className="bg-[#111113]/80 backdrop-blur-xl border border-zinc-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          
          {/* Subtle top glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-emerald-500/50 blur-[2px]"></div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-1">
              {step === "email" ? "Authentication Protocol" : "Verify Magic Code"}
            </h2>
            <p className="text-sm text-zinc-500">
              {step === "email" 
                ? "Enter your institutional email to receive a secure login link." 
                : `Enter the 6-digit code sent to ${email}`}
            </p>
          </div>

          {/* Message Alert */}
          {message.text && (
            <div className={`p-4 rounded-xl mb-6 text-sm flex items-start gap-3 border ${
              message.type === "success" 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}>
              {message.type === "success" ? <ShieldCheck className="w-5 h-5 flex-shrink-0" /> : <ShieldAlert className="w-5 h-5 flex-shrink-0" />}
              <span className="mt-0.5">{message.text}</span>
            </div>
          )}

          {/* Form State: EMAIL */}
          {step === "email" ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Email Address</label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 w-5 h-5 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="analyst@fund.com"
                    required
                    className="w-full bg-[#09090b] border border-zinc-800 rounded-xl py-4 pl-12 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                    disabled={loading}
                  />
                </div>
              </div>
              
              <button 
                type="submit"
                disabled={loading || !email}
                className="w-full bg-white hover:bg-zinc-200 text-black font-semibold rounded-xl py-4 px-4 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Send Magic Code
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Form State: OTP VERIFICATION */
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Security Code</label>
                <div className="relative flex items-center">
                  <KeyRound className="absolute left-4 w-5 h-5 text-zinc-500" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="000000"
                    required
                    maxLength={6}
                    className="w-full bg-[#09090b] border border-zinc-800 rounded-xl py-4 pl-12 pr-4 text-white text-center tracking-[0.5em] font-mono text-lg placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                    disabled={loading}
                  />
                </div>
              </div>
              
              <button 
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl py-4 px-4 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify & Access"}
              </button>
              
              <div className="text-center pt-2">
                <button 
                  type="button" 
                  onClick={() => { setStep("email"); setOtp(""); setMessage({text: "", type: ""}) }}
                  className="text-xs text-zinc-500 hover:text-white transition-colors"
                  disabled={loading}
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}

        </div>
        
        {/* Footer */}
        <div className="text-center mt-10">
          <p className="text-xs text-zinc-600">
            Protected by ORACLE Matrix Auth. <br/> By entering, you agree to our Terms of Service.
          </p>
        </div>

      </div>
    </div>
  );
}