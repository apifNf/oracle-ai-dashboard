"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Gauge, MessageSquareText, NotebookPen, Settings, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/scanner", label: "Scanner", icon: Bot },
  { href: "/ai-chat", label: "AI Chat", icon: MessageSquareText },
  { href: "/market-intelligence", label: "Market Intelligence", icon: Globe },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-b border-slate-200 bg-white/80 dark:border-white/10 dark:bg-[#0A0A0A]/80 px-4 py-3 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:w-64 md:border-b-0 md:border-r md:p-5 transition-colors duration-500 z-50">
      <div className="flex items-center justify-between md:block">
        <Link href="/" className="text-xl font-semibold tracking-wide text-slate-900 dark:text-zinc-50 transition-colors duration-500">
          ORACLE
        </Link>
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-zinc-400 md:mt-1 md:block transition-colors duration-500">
          Crypto Analyst
        </span>
      </div>
      <nav className="mt-4 flex gap-2 overflow-x-auto md:mt-8 md:block md:space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-300",
                isActive 
                  ? "bg-slate-100 text-emerald-600 dark:bg-white/10 dark:text-emerald-400 font-medium" 
                  : "text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}