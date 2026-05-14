"use server";

import { revalidatePath } from "next/cache";

import { getCredentialPlaintext } from "@/lib/db/credentials";
import {
  addProject,
  deleteProjectById,
  setProjectBlueprint,
} from "@/lib/db/projects";
import { probeGitHubRepo } from "@/lib/providers/github";
import { requireActorEmail } from "@/lib/server-actor";

function parseRepoInput(input: string): { owner: string; repo: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("repo is required");

  // Accept "owner/repo" or a full GitHub URL.
  let candidate = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      candidate = url.pathname.replace(/^\/+|\/+$/g, "");
    }
  } catch {
    // Fall through; we'll validate below.
  }

  const parts = candidate.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error('expected "owner/repo" or a GitHub URL');
  }
  const [owner, repo] = parts;
  const cleanRepo = repo.replace(/\.git$/i, "");
  // Owner allows underscores to cover GitHub Enterprise Managed User
  // (EMU) names such as `IDP-USERNAME_SHORT-CODE`. Repo allows dots too
  // (e.g. `my.repo`). Both stay tight enough to reject shell metacharacters.
  if (!/^[A-Za-z0-9_-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(cleanRepo)) {
    throw new Error("owner or repo contains invalid characters");
  }
  return { owner, repo: cleanRepo };
}

export async function addProjectAction(formData: FormData): Promise<void> {
  const raw = formData.get("repo");
  if (typeof raw !== "string") throw new Error("repo is required");
  const { owner, repo } = parseRepoInput(raw);

  // If a GitHub PAT is stored, use it to confirm the repo exists and to
  // prefill default_branch. Without a token, fall back to inserting without
  // a default branch — the operator can re-add once the PAT is verified.
  let defaultBranch: string | null = null;
  const token = await getCredentialPlaintext("github_pat");
  if (token) {
    const check = await probeGitHubRepo(token, owner, repo);
    if (!check.ok) {
      throw new Error(
        `GitHub rejected the repo lookup: ${check.message}. Confirm the operator's PAT has access to ${owner}/${repo}.`,
      );
    }
    defaultBranch = check.defaultBranch ?? null;
  }

  await addProject({
    owner,
    repo,
    defaultBranch,
    actor: await requireActorEmail(),
  });
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function removeProjectAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new Error("project id is required");
  await deleteProjectById(id, await requireActorEmail());
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function setProjectBlueprintAction(
  formData: FormData,
): Promise<void> {
  const projectId = formData.get("projectId");
  const rawBlueprint = formData.get("blueprintId");
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("projectId is required");
  }
  const blueprintId =
    typeof rawBlueprint === "string" && rawBlueprint !== ""
      ? rawBlueprint
      : null;
  await setProjectBlueprint({
    projectId,
    blueprintId,
    actor: await requireActorEmail(),
  });
  revalidatePath("/projects");
}
