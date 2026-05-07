import { PageShell } from "@/components/page-shell";
import { PlaceholderCard } from "@/components/placeholder-card";

export default function BlueprintsPage() {
  return (
    <PageShell
      eyebrow="Library"
      title="Blueprints"
      description="A blueprint declares the steps needed to ship a class of project: framework, env vars, build commands, and provider operations."
    >
      <PlaceholderCard
        title="Coming in Session 3"
        description="Blueprint authoring and per-project binding lands here. Initial blueprints will cover Next.js + Neon (for herm-platform) and Next.js static + Neon (for EquiSmile)."
        bullets={[
          "Built-in blueprints for Next.js, Prisma, and Neon",
          "Side-by-side diff between blueprint versions",
          "Resolve env vars to a deploy plan",
        ]}
      />
    </PageShell>
  );
}
