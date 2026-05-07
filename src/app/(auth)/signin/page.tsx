import { ShieldAlert } from "lucide-react";

import { Logo } from "@/components/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

import { SignInButton } from "./sign-in-button";

interface SignInPageProps {
  searchParams: { error?: string; callbackUrl?: string };
}

const errorCopy: Record<string, { title: string; body: string }> = {
  AccessDenied: {
    title: "This account isn't on the allowlist",
    body: "DeployOps Console is locked to a single operator email. Sign in with the GitHub account whose verified email matches ALLOWED_EMAIL.",
  },
  Configuration: {
    title: "Sign-in is misconfigured",
    body: "The server failed to load the GitHub OAuth configuration. Check NEXTAUTH_SECRET, GITHUB_OAUTH_CLIENT_ID, and GITHUB_OAUTH_CLIENT_SECRET on the server.",
  },
  default: {
    title: "Sign-in failed",
    body: "GitHub returned an error during sign-in. Try again, and if it keeps failing check the server logs.",
  },
};

export default function SignInPage({ searchParams }: SignInPageProps) {
  const errorKey = searchParams?.error;
  const error = errorKey
    ? (errorCopy[errorKey] ?? errorCopy.default)
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={40} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              DeployOps Console
            </h1>
            <p className="text-sm text-muted-foreground">
              Single-operator deployment dashboard.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardDescription>
              Sign in with the operator&rsquo;s GitHub account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInButton callbackUrl={searchParams?.callbackUrl} />
          </CardContent>
          {error ? (
            <CardFooter className="block">
              <div
                role="alert"
                className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="space-y-1">
                  <p className="font-medium">{error.title}</p>
                  <p className="text-destructive/80">{error.body}</p>
                </div>
              </div>
            </CardFooter>
          ) : null}
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By signing in you agree this is a private tool. No telemetry is sent.
        </p>
      </div>
    </div>
  );
}
