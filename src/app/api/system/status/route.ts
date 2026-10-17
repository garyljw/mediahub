import "server-only";
import { getRadarrStatus, getSonarrStatus, type ArrStatus } from "@/server/arr/system";
import { connection } from "next/server";
import { authzErrorResponse, requireRole } from "@/server/authz";

// Cache Components is enabled, so this handler is prerendered unless it asks for
// the request. connection() marks it dynamic, so it runs per request and is never cached.
// Route segment `dynamic` configs are not used; the Cache Components migration guide replaces them.

type ServiceStatus = { ok: true; version: string } | { ok: false };

function toServiceStatus(name: "Radarr" | "Sonarr", result: PromiseSettledResult<ArrStatus>): ServiceStatus {
  if (result.status === "fulfilled") return { ok: true, version: result.value.version };
  // Log for operators, but never send the message to the client. The messages from
  // src/server/arr/system.ts and env() contain no hosts, URLs or key values.
  const reason = result.reason;
  console.error(`[status] ${name} failed:`, reason instanceof Error ? reason.message : "unknown error");
  return { ok: false };
}

export async function GET() {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const [radarr, sonarr] = await Promise.allSettled([getRadarrStatus(), getSonarrStatus()]);
  const body = {
    radarr: toServiceStatus("Radarr", radarr),
    sonarr: toServiceStatus("Sonarr", sonarr),
  };
  const allOk = body.radarr.ok && body.sonarr.ok;
  return Response.json(body, { status: allOk ? 200 : 502 });
}
