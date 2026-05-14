import { probeJson } from "@/lib/providers/probe";

import type { LiveStageContext, StageOutcome } from "./types";

export async function liveSmokeTest(
  ctx: LiveStageContext,
): Promise<StageOutcome> {
  const probeUrl = `https://${ctx.plan.predicted.deployHost}/api/health`;
  const start = Date.now();
  const res = await probeJson(probeUrl, { headers: {} });
  const latencyMs = Date.now() - start;
  if (res.ok) {
    return {
      status: "succeeded",
      logLines: [
        `GET ${probeUrl} → 200 in ${latencyMs}ms.`,
        `Response: ${JSON.stringify(res.detail).slice(0, 200)}`,
      ],
      output: {
        probeUrl,
        status: res.status,
        latencyMs,
        body: res.detail ?? null,
      },
    };
  }
  return {
    status: "failed",
    logLines: [
      `GET ${probeUrl} failed: ${res.message}`,
      `Latency: ${latencyMs}ms.`,
      "Smoke test expects a 2xx with JSON body.",
    ],
    output: { probeUrl, status: res.status, latencyMs },
    error: { message: res.message },
  };
}

export function liveEnvResolve(
  ctx: LiveStageContext,
): StageOutcome {
  // env.resolve is pure: same shape as the simulator, but flag the live path.
  const counts = ctx.plan.envVars.reduce<Record<string, number>>(
    (acc, v) => {
      acc[v.source] = (acc[v.source] ?? 0) + 1;
      return acc;
    },
    {},
  );
  return {
    status: "succeeded",
    logLines: [
      `Resolving ${ctx.plan.envVars.length} env var${ctx.plan.envVars.length === 1 ? "" : "s"} (live, identical to dry-run logic).`,
      ...ctx.plan.envVars.map(
        (v) =>
          `  ${v.key} = <${v.source}>${v.value ? " ✓ resolved" : " · deferred"}`,
      ),
      `Sources: ${Object.entries(counts)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ")}`,
    ],
    output: { envVars: ctx.plan.envVars, counts, live: true },
  };
}
