import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from 'next-themes'

export const metadata: Metadata = {
  title: "ORACLE",
  description: "Personal AI crypto trading analyst dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning wajib agar next-themes tidak memunculkan error console
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={true}>
          
          <AppShell>
            {/* Wadah fleksibel untuk menyeimbangkan konten dan footer */}
            <div className="flex flex-col h-full min-h-[calc(100vh-4rem)]">
              
              {/* Area Utama Konten Halaman */}
              <div className="flex-1">
                {children}
              </div>

              {/* AREA BRANDING A-TECH LABS */}
              <footer className="w-full mt-auto pt-6 pb-3 flex justify-end items-center pr-5">
                <p className="text-xs font-medium text-zinc-600 tracking-wide">
                  © 2026 ORACLE. All Rights Reserved. | Created by <span className="text-slate-600 dark:text-zinc-400 font-bold hover:!text-emerald-500 dark:hover:!text-emerald-400 transition-colors cursor-pointer">A-Tech Labs</span>
                </p>
              </footer>

            </div>
          </AppShell>

        </ThemeProvider>
      </body>
    </html>
  );
}