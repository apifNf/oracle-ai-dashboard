import { Sidebar } from "@/components/layout/sidebar";
import ThemeToggle from "@/components/layout/theme-toggle";
import LanguageToggle from "@/components/layout/language-toggle";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0A0A0A] dark:text-zinc-50 transition-colors duration-500 flex flex-col">
      <Sidebar />
      {/* pb-20: ruang untuk bottom nav mobile (fixed, lihat Sidebar) — tidak
          berlaku di md+ karena bottom nav itu sendiri hidden di sana. */}
      <main className="flex-1 px-3 py-3 pb-20 md:px-4 md:py-4 md:pb-6 md:pl-72 md:pr-8 lg:pr-10 flex flex-col">
        <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col">

          {/* Topbar: Diberi padding-top agar sejajar/balance dengan judul halaman */}
          <div className="w-full flex items-center justify-end gap-2 md:gap-3 pt-1 pb-1 mb-3 md:pt-2 md:pb-2 md:mb-6">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          
          {/* Area Konten Utama */}
          <div className="flex-1">
            {children}
          </div>
          
          {/*  */}
          
        </div>
      </main>
    </div>
  );
}