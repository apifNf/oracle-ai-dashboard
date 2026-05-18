"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Gauge, MessageSquareText, NotebookPen, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/scanner", label: "Scanner", icon: Bot },
  { href: "/ai-chat", label: "AI Chat", icon: MessageSquareText },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-b bg-card/80 px-4 py-3 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:w-64 md:border-b-0 md:border-r md:p-5">
      <div className="flex items-center justify-between md:block">
        <Link href="/" className="text-xl font-semibold tracking-wide">
          ORACLE
        </Link>
        <span className="text-xs uppercase tracking-[0.2em] text-muted md:mt-1 md:block">Crypto Analyst</span>
      </div>
      <nav className="mt-4 flex gap-2 overflow-x-auto md:mt-8 md:block md:space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-foreground",
                isActive && "bg-white/5 text-foreground"
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
