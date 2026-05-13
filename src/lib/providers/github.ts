import { probeJson, type ProbeResult } from "@/lib/providers/probe";

export async function probeGitHub(token: string): Promise<ProbeResult> {
  return probeJson("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "deployops-console",
    },
  });
}

interface GitHubRepoCheck {
  ok: boolean;
  status: number;
  message: string;
  defaultBranch?: string;
}

export async function probeGitHubRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRepoCheck> {
  const result = await probeJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "deployops-console",
      },
    },
  );
  const defaultBranch =
    typeof result.detail?.default_branch === "string"
      ? result.detail.default_branch
      : undefined;
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    defaultBranch,
  };
}
