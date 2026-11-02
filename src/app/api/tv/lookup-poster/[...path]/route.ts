import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { TVDB_POSTER_PATH, getTvdbPoster } from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";

// Only a TVDB poster path ("banners/v4/series/81189/posters/abc.jpg") is accepted. Anything else is a 404
// before any fetch. The path is the only input, and the upstream host is fixed in getTvdbPoster.
const posterPath = z.string().regex(TVDB_POSTER_PATH);

// Serves one TVDB poster per validated path, for the Add series search results and the season cards
// on the series page. It is not a pass-through proxy.
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const parsed = posterPath.safeParse((await params).path.join("/"));
  if (!parsed.success) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const bytes = await getTvdbPoster(parsed.data);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        // A TVDB poster file rarely changes, and a week-old search thumbnail is harmless.
        "Cache-Control": "private, max-age=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // TVDB has no such file (e.g. a removed season poster). Expected, so a plain 404 and no log line.
      if (error.status === 404) return Response.json({ error: "not found" }, { status: 404 });
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[tv-lookup-poster] ${error.message}`);
      return Response.json({ error: "poster unavailable" }, { status: 502 });
    }
    throw error;
  }
}
