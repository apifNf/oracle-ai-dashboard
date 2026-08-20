import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "ORACLE",
  description: "Personal AI crypto trading analyst dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppShell>
          {/* Wadah fleksibel untuk menyeimbangkan konten dan footer */}
          <div className="flex flex-col h-full min-h-[calc(100vh-4rem)]">
            
            {/* Area Utama Konten Halaman */}
            <div className="flex-1">
              {children}
            </div>
            
            {/* AREA BRANDING A-TECH LABS */}
            <footer className="w-full mt-auto pt-8 pb-4 flex justify-end items-center">
              <p className="text-xs font-medium text-zinc-600 tracking-wide">
                Designed by <span className="text-zinc-400 font-semibold hover:text-emerald-500 transition-colors cursor-default">A-Tech Labs</span>
              </p>
            </footer>
            
          </div>
        </AppShell>
      </body>
    </html>
  );
}