import { PageShell } from "@/components/page-shell";
import { listCredentials } from "@/lib/db/credentials";

import {
  CredentialCard,
  PROVIDER_META,
} from "./_components/credential-card";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const credentials = await listCredentials();
  const byKind = new Map(credentials.map((c) => [c.kind, c]));

  return (
    <PageShell
      eyebrow="Operations"
      title="Connection Center"
      description="Operator credentials for GitHub, Vercel, and Neon. Encrypted at rest with the server-side ENCRYPTION_KEY. Plaintext never leaves the server — only the last four characters and the connection state are exposed to the UI."
    >
      <section
        aria-label="Provider credentials"
        className="flex max-w-3xl flex-col gap-4"
      >
        {PROVIDER_META.map((meta) => (
          <CredentialCard
            key={meta.kind}
            meta={meta}
            view={byKind.get(meta.kind) ?? null}
          />
        ))}
      </section>
    </PageShell>
  );
}
