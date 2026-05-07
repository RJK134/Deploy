import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function ProjectsPage() {
  return (
    <PageShell
      eyebrow="Workspace"
      title="Projects"
      description="The two real products this console will manage are RJK134/herm-platform and RJK134/EquiSmile."
    >
      <PlaceholderCard
        title="Coming in Session 2"
        description="Project onboarding lives behind the GitHub App connection. Once the App is installed and a repo is selected, this page lists every connected repo with its default branch, framework, and live blueprint."
        bullets={[
          "GitHub App install + repo picker",
          "Per-project blueprint binding",
          "Quick-deploy entry point per project",
        ]}
      />
    </PageShell>
  );
}
