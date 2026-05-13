import { probeJson, type ProbeResult } from "@/lib/providers/probe";

export async function probeVercel(token: string): Promise<ProbeResult> {
  return probeJson("https://api.vercel.com/v2/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}
