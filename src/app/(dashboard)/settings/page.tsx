import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";

import { SignOutButton } from "./sign-out-button";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "local";
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  const liveMode = process.env.DEPLOYOPS_LIVE === "1";

  return (
    <PageShell
      eyebrow="Account"
      title="Settings"
      description="Operator profile and session controls. Multi-user, RBAC, and team settings are intentionally out of scope."
    >
      <Card>
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono">{session.user.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{session.user.name ?? "—"}</dd>
          </dl>
          <Separator />
          <SignOutButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="font-mono">{branch}</dd>
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-mono">{commit.slice(0, 12)}</dd>
            <dt className="text-muted-foreground">Live mode</dt>
            <dd className="font-mono">
              {liveMode ? "ON (DEPLOYOPS_LIVE=1)" : "OFF — dry-run only"}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </PageShell>
  );
}
