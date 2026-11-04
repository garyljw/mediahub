import "server-only";
import { connection } from "next/server";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { listMovieActivity } from "@/server/arr/activity";
import { ArrRequestError } from "@/server/arr/request";

const NO_STORE = { "Cache-Control": "no-store" };

// Home and the movie page poll this every 10 seconds, so it is a GET route and not a server action. Next runs
// server actions one at a time per client, so a poll as an action would queue behind a 90 second release
// search and delay the user's clicks. Route handlers run in parallel.
//
// Takes nothing from the request. Only the queue state is read from Radarr.
export async function GET() {
  await connection();
  let user;
  try {
    ({ user } = await requireRole("admin", "requester"));
  } catch (error) {
    return authzErrorResponse(error);
  }

  try {
    // Messages can contain server paths and only admins can act on import problems, so requesters never get them.
    const items = await listMovieActivity({ includeMessages: user.role === "admin" });
    return Response.json({ items }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[activity] ${error.message}`);
      return Response.json({ error: "activity unavailable" }, { status: 502, headers: NO_STORE });
    }
    throw error;
  }
}
