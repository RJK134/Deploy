import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function RunsPage() {
  return (
    <PageShell
      eyebrow="Workspace"
      title="Runs"
      description="A run is one trip through the deploy pipeline for a project, in either dry-run or live mode."
    >
      <PlaceholderCard
        title="Coming in Session 4"
        description="Runs land here once the pipeline orchestrator is online. Each row will link to a stage-by-stage detail view with streaming logs, plan diff, and approval gate."
        bullets={[
          "Filter by project, environment, and status",
          "Dry-run vs live indicator per row",
          "Tail logs and stage timeline on row click",
        ]}
      />
    </PageShell>
  );
}
