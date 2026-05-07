import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { auth } from "@/lib/auth";
import { isLiveMode } from "@/lib/env";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "local";

  return (
    <div className="min-h-screen">
      <AppSidebar branch={branch} liveMode={isLiveMode} />
      <div className="md:pl-64">
        <DashboardHeader user={session.user} />
        <main>{children}</main>
      </div>
    </div>
  );
}
