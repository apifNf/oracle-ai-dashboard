import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

export function MetricCard({ icon: Icon, label, value, detail }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{label}</p>
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <p className="mt-4 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </div>
  );
}
