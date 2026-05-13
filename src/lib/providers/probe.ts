export interface ProbeResult {
  ok: boolean;
  status: number;
  message: string;
  detail?: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;

export async function probeJson(
  url: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `${res.status} ${res.statusText || "request failed"}`,
        detail: isObject(body) ? body : undefined,
      };
    }
    return {
      ok: true,
      status: res.status,
      message: "ok",
      detail: isObject(body) ? body : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message:
        err instanceof Error && err.name === "AbortError"
          ? "request timed out"
          : err instanceof Error
            ? err.message
            : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
