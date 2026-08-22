import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

export function MetricCard({ icon: Icon, label, value, detail }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#141414] dark:shadow-none transition-colors duration-500">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-slate-500 dark:text-zinc-400 transition-colors duration-500">{label}</p>
        <Icon className="h-4 w-4 text-emerald-500 dark:text-emerald-400 transition-colors duration-500" />
      </div>
      <p className="mt-4 text-2xl font-semibold text-slate-900 dark:text-zinc-50 transition-colors duration-500">{value}</p>
      <p className="mt-2 text-sm text-slate-400 dark:text-zinc-500 transition-colors duration-500">{detail}</p>
    </div>
  );
}