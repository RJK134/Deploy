"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the browser console for debugging; the full
    // server stack is in the Next.js logs.
    if (error?.digest) {
      console.error("[deployops] error.tsx digest:", error.digest);
    }
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          <CardTitle className="text-base text-foreground">
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred while rendering this page. The
            operator-facing details have been written to the server logs.
          </p>
          {error?.digest ? (
            <p className="font-mono text-xs text-muted-foreground">
              digest: {error.digest}
            </p>
          ) : null}
          <Button onClick={reset} variant="outline" size="sm">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
