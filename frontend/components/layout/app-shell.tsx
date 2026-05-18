import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="px-4 py-6 md:pl-72 md:pr-8 lg:pr-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
