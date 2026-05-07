import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PlaceholderCardProps {
  title: string;
  description: string;
  bullets?: string[];
  cta?: React.ReactNode;
}

export function PlaceholderCard({
  title,
  description,
  bullets,
  cta,
}: PlaceholderCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>{description}</p>
        {bullets && bullets.length > 0 ? (
          <ul className="list-inside list-disc space-y-1">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        {cta}
      </CardContent>
    </Card>
  );
}
