import { Sidebar } from "@/components/layout/sidebar";
import ThemeToggle from "@/components/layout/theme-toggle";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0A0A0A] dark:text-zinc-50 transition-colors duration-500 flex flex-col">
      <Sidebar />
      <main className="flex-1 px-4 py-6 md:pl-72 md:pr-8 lg:pr-10 flex flex-col">
        <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col">
          
          {/* Topbar: Diberi padding-top agar sejajar/balance dengan judul halaman */}
          <div className="w-full flex justify-end pt-2 pb-2 mb-6">
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