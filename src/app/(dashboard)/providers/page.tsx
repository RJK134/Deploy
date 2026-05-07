import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function ProvidersPage() {
  return (
    <PageShell
      eyebrow="Operations"
      title="Connection Center"
      description="Connect the operator's GitHub App, Vercel team, and Neon project. Credentials are encrypted at rest with ENCRYPTION_KEY."
    >
      <PlaceholderCard
        title="Coming in Session 2"
        description="Provider connection forms (GitHub App install URL, Vercel token paste, Neon API key paste) live here. This session only validates that ENCRYPTION_KEY is configured — the encryption helper itself ships in Session 2."
        bullets={[
          "GitHub App install with read-only repo and pull-request scopes",
          "Vercel token with hobby/team selector",
          "Neon API key with project selector",
          "Connection state tracked in provider_credentials",
        ]}
      />
    </PageShell>
  );
}
