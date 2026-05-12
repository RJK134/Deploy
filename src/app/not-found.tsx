import Link from "next/link";
import { Compass, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Compass className="h-5 w-5 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base text-foreground">
            Page not found
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The URL you visited isn&rsquo;t part of the console. It may have been
            renamed or it&rsquo;s still on its way (most pages ship in Sessions 2–6).
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <Home className="h-4 w-4" aria-hidden />
              Back to Overview
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
