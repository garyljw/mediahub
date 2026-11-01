import "server-only";
import { connection } from "next/server";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { getSeriesPoster } from "@/server/arr/series";
import { servePosterResponse } from "@/server/arr/poster";

// Serves one fixed Sonarr file per validated series id. It is not a pass-through proxy:
// the path and filename are never taken from the request.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  return servePosterResponse((await params).id, (id) => getSeriesPoster(id));
}
