import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { listEpisodeActivity } from "@/server/arr/activity";
import { ArrRequestError } from "@/server/arr/request";

const NO_STORE = { "Cache-Control": "no-store" };

// Plain digits only, and a positive id. The same rule as the series page.
const seriesId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

// The series page polls this every 10 seconds, so it is a GET route and not a server action, for the same
// reason as the Movies activity route: route handlers run in parallel, server actions queue.
//
// Takes only the series id from the path. Only that series' queue state is read from Sonarr.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  let user;
  try {
    ({ user } = await requireRole("admin", "requester"));
  } catch (error) {
    return authzErrorResponse(error);
  }

  const parsed = seriesId.safeParse((await params).id);
  if (!parsed.success) {
    return Response.json({ error: "invalid id" }, { status: 400, headers: NO_STORE });
  }

  try {
    // Messages can contain server paths and only admins can act on import problems, so requesters never get them.
    const items = await listEpisodeActivity(parsed.data, { includeMessages: user.role === "admin" });
    return Response.json({ items }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[tv-episode-activity] ${error.message}`);
      return Response.json({ error: "activity unavailable" }, { status: 502, headers: NO_STORE });
    }
    throw error;
  }
}
