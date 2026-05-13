import { probeJson, type ProbeResult } from "@/lib/providers/probe";

export async function probeNeon(apiKey: string): Promise<ProbeResult> {
  return probeJson("https://console.neon.tech/api/v2/projects?limit=1", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
}
