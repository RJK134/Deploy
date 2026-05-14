import type { StageKind } from "@/lib/pipeline/stages";

import { liveCiGenerate, liveRepoScan } from "./github";
import { liveDbMigrate, liveDbProvision } from "./neon";
import { liveEnvResolve, liveSmokeTest } from "./smoke";
import type {
  LiveStageContext,
  LiveStageRunner,
  StageOutcome,
} from "./types";
import { liveDeploy, liveDomainAttach } from "./vercel";

const ADAPTERS: Record<StageKind, LiveStageRunner> = {
  "repo.scan": liveRepoScan,
  "env.resolve": async (ctx) => liveEnvResolve(ctx),
  "db.provision": liveDbProvision,
  "db.migrate": liveDbMigrate,
  "ci.generate": liveCiGenerate,
  deploy: liveDeploy,
  "domain.attach": liveDomainAttach,
  "smoke.test": liveSmokeTest,
};

export async function executeStageLive(
  kind: StageKind,
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const adapter = ADAPTERS[kind];
  return adapter(ctx);
}
