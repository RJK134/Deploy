import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function PipelinesPage() {
  return (
    <PageShell
      eyebrow="Library"
      title="Pipelines"
      description="The eight-stage pipeline reference for any DeployOps run."
    >
      <PlaceholderCard
        title="Coming in Session 3"
        description="The shared pipeline definition (repo scan → env resolve → DB provision → migrate → CI generate → deploy → domain → smoke test) renders here as a documented spec, with each stage's allowed verbs and timeouts."
      />
    </PageShell>
  );
}
