import { afterEach, describe, expect, it, vi } from "vitest";

import { liveDbProvision, liveDbMigrate } from "@/lib/live/neon";
import { liveDeploy, liveDomainAttach } from "@/lib/live/vercel";
import type { LiveStageContext } from "@/lib/live/types";

type FetchInit = (RequestInit & { headers?: Record<string, string> }) | undefined;
type FetchHandler = (
  url: string,
  init: FetchInit,
) => Promise<Response> | Response;

function installFetch(handler: FetchHandler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url, init as FetchInit));
  }) as typeof fetch);
}

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "content-type": "application/json" },
  });
}

function buildCtx(
  overrides: Partial<LiveStageContext> = {},
): LiveStageContext {
  return {
    plan: {
      blueprintSlug: "nextjs-neon",
      blueprintName: "Next.js + Neon",
      framework: "nextjs",
      environment: "test",
      project: {
        id: "p_test",
        slug: "rjk134/herm-platform",
        githubOwner: "RJK134",
        githubRepo: "herm-platform",
        defaultBranch: "main",
        customDomain: null,
      },
      commands: { install: "pnpm install", build: "pnpm build" },
      envVars: [],
      stages: [],
      predicted: {
        branchName: "test-herm-platform",
        deployHost: "herm-platform-test.vercel.app",
      },
    },
    providerIds: {
      vercelProjectId: "prj_abc",
      vercelTeamId: "team_xyz",
      neonProjectId: "neon_xyz",
    },
    credentials: { github: "gh", vercel: "vc", neon: "napi" },
    ...overrides,
  };
}

describe("liveDbProvision", () => {
  afterEach(() => vi.restoreAllMocks());

  it("re-uses an existing branch (no POST sent)", async () => {
    const calls: { url: string; method: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return jsonResponse({
        branches: [{ id: "br_existing", name: "test-herm-platform" }],
      });
    });
    const outcome = await liveDbProvision(buildCtx());
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({
      branchId: "br_existing",
      created: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });

  it("POSTs to create the branch when it doesn't exist", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    installFetch((url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (init?.method === "POST") {
        return jsonResponse({
          branch: { id: "br_new", name: "test-herm-platform" },
        });
      }
      return jsonResponse({ branches: [] });
    });
    const outcome = await liveDbProvision(buildCtx());
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({
      branchId: "br_new",
      created: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toContain("test-herm-platform");
  });

  it("returns notImplemented when neonProjectId is missing", async () => {
    const outcome = await liveDbProvision(
      buildCtx({
        providerIds: {
          vercelProjectId: "prj",
          vercelTeamId: null,
          neonProjectId: null,
        },
      }),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.output).toMatchObject({ liveExecuted: false });
  });

  it("propagates a 401 from the list call", async () => {
    installFetch(() =>
      jsonResponse({}, { status: 401, statusText: "Unauthorized" }),
    );
    const outcome = await liveDbProvision(buildCtx());
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatchObject({ provider: "neon" });
  });

  it("propagates a failed POST", async () => {
    installFetch((url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(
          { error: "rate_limited" },
          { status: 429, statusText: "Too Many Requests" },
        );
      }
      return jsonResponse({ branches: [] });
    });
    const outcome = await liveDbProvision(buildCtx());
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatchObject({ branchName: "test-herm-platform" });
  });
});

describe("liveDbMigrate", () => {
  it("always succeeds with a deferred-to-CI message (no API call)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const outcome = await liveDbMigrate(buildCtx());
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({
      executedHere: false,
      deferredTo: "github-actions",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("liveDeploy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs /v13/deployments for a linked project", async () => {
    const calls: { url: string; method: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") {
        return jsonResponse({
          id: "dpl_new",
          url: "herm-platform-abc.vercel.app",
        });
      }
      return jsonResponse({
        name: "herm-platform",
        link: { type: "github", repo: "herm-platform", org: "RJK134" },
        framework: "nextjs",
      });
    });
    const outcome = await liveDeploy(buildCtx());
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({
      deploymentId: "dpl_new",
      url: "https://herm-platform-abc.vercel.app",
      target: "preview",
    });
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("targets 'production' when environment='deploy'", async () => {
    let body: string | undefined;
    installFetch((url, init) => {
      if (init?.method === "POST") {
        body = typeof init.body === "string" ? init.body : undefined;
        return jsonResponse({ id: "dpl", url: "x.vercel.app" });
      }
      return jsonResponse({ link: { type: "github", repo: "x", org: "y" } });
    });
    const ctx = buildCtx();
    ctx.plan.environment = "deploy";
    const outcome = await liveDeploy(ctx);
    expect(outcome.status).toBe("succeeded");
    expect(body).toContain('"target":"production"');
  });

  it("fails when the project isn't linked to a Git repo", async () => {
    installFetch(() => jsonResponse({ name: "x", link: null }));
    const outcome = await liveDeploy(buildCtx());
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatchObject({
      reason: "project not linked to a git repository",
    });
  });

  it("returns notImplemented without a vercelProjectId", async () => {
    const outcome = await liveDeploy(
      buildCtx({
        providerIds: {
          vercelProjectId: null,
          vercelTeamId: null,
          neonProjectId: "n",
        },
      }),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.output).toMatchObject({ liveExecuted: false });
  });
});

describe("liveDomainAttach", () => {
  afterEach(() => vi.restoreAllMocks());

  it("succeeds with 'no custom_domain configured' when project has none", async () => {
    installFetch(() => jsonResponse({ domains: [] }));
    const outcome = await liveDomainAttach(buildCtx());
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({ configuredDomain: null });
  });

  it("re-uses an already-attached domain", async () => {
    const calls: { url: string; method: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return jsonResponse({ domains: [{ name: "app.example.com" }] });
    });
    const ctx = buildCtx();
    ctx.plan.project.customDomain = "app.example.com";
    const outcome = await liveDomainAttach(ctx);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({ created: false, attached: true });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("POSTs to attach a new domain", async () => {
    const calls: { url: string; method: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST")
        return jsonResponse({ name: "new.example.com" });
      return jsonResponse({ domains: [] });
    });
    const ctx = buildCtx();
    ctx.plan.project.customDomain = "new.example.com";
    const outcome = await liveDomainAttach(ctx);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toMatchObject({ created: true, attached: true });
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("surfaces a verification failure on the POST", async () => {
    installFetch((url, init) => {
      if (init?.method === "POST")
        return jsonResponse(
          { error: "missing_verification_record" },
          { status: 403, statusText: "Forbidden" },
        );
      return jsonResponse({ domains: [] });
    });
    const ctx = buildCtx();
    ctx.plan.project.customDomain = "broken.example.com";
    const outcome = await liveDomainAttach(ctx);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatchObject({ domain: "broken.example.com" });
  });
});
