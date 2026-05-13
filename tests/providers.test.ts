import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeGitHub, probeGitHubRepo } from "@/lib/providers/github";
import { probeNeon } from "@/lib/providers/neon";
import { probeVercel } from "@/lib/providers/vercel";

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

describe("GitHub probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok for a 200 from /user", async () => {
    const spy = installFetch((url, init) => {
      expect(url).toBe("https://api.github.com/user");
      expect(init?.headers?.Authorization).toBe("Bearer test-token");
      return jsonResponse({ login: "octocat" });
    });
    const result = await probeGitHub("test-token");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns !ok for a 401 from /user", async () => {
    installFetch(() =>
      jsonResponse(
        { message: "Bad credentials" },
        { status: 401, statusText: "Unauthorized" },
      ),
    );
    const result = await probeGitHub("bad-token");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/401/);
  });

  it("repo probe surfaces default_branch", async () => {
    installFetch((url) => {
      expect(url).toBe("https://api.github.com/repos/octo/repo");
      return jsonResponse({ default_branch: "main", name: "repo" });
    });
    const check = await probeGitHubRepo("test", "octo", "repo");
    expect(check.ok).toBe(true);
    expect(check.defaultBranch).toBe("main");
  });

  it("repo probe escapes path segments", async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      return jsonResponse({}, { status: 404, statusText: "Not Found" });
    });
    await probeGitHubRepo("t", "with space", "repo");
    expect(calls[0]).toContain("with%20space");
  });
});

describe("Vercel probe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns ok for 200 from /v2/user", async () => {
    installFetch((url, init) => {
      expect(url).toBe("https://api.vercel.com/v2/user");
      expect(init?.headers?.Authorization).toBe("Bearer vc-token");
      return jsonResponse({ user: { id: "u1" } });
    });
    const result = await probeVercel("vc-token");
    expect(result.ok).toBe(true);
  });

  it("returns !ok for 403 from /v2/user", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "forbidden" } },
        { status: 403, statusText: "Forbidden" },
      ),
    );
    const result = await probeVercel("nope");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe("Neon probe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns ok for 200 from /api/v2/projects", async () => {
    installFetch((url, init) => {
      expect(url).toBe("https://console.neon.tech/api/v2/projects?limit=1");
      expect(init?.headers?.Authorization).toBe("Bearer napi-key");
      return jsonResponse({ projects: [] });
    });
    const result = await probeNeon("napi-key");
    expect(result.ok).toBe(true);
  });

  it("returns !ok for a network failure", async () => {
    installFetch(() => {
      throw new Error("network down");
    });
    const result = await probeNeon("napi-key");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toMatch(/network down/);
  });
});

describe("probe timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 'request timed out' if the abort signal fires", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const pending = probeGitHub("any");
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toBe("request timed out");
  });
});
