import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function AccessPage() {
  return (
    <PageShell
      eyebrow="Operations"
      title="Access & domains"
      description="Per-project access mode, custom domain attachment, and viewer URLs."
    >
      <PlaceholderCard
        title="Coming in Session 5"
        description="Public, client, and private access modes are picked here, with domain attachment to Vercel and DNS guidance. Until the Vercel adapter ships, this page intentionally shows nothing."
      />
    </PageShell>
  );
}
