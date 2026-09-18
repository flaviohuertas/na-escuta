import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth.config";
import { SyncProvider } from "@/components/providers/SyncProvider";
import { SyncStatusBar } from "@/components/sync/SyncStatusBar";
import { AppNav } from "@/components/layout/AppNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <SyncProvider>
      <div className="flex min-h-dvh flex-col">
        <SyncStatusBar />
        <div className="flex flex-1 flex-col md:flex-row">
          <AppNav userName={session.user.name} />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SyncProvider>
  );
}
