import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { TMDB_POSTER_FILE, getTmdbPoster } from "@/server/arr/movie-add";
import { ArrRequestError } from "@/server/arr/request";

// Only a bare TMDB file name ("abc123.jpg") is accepted. Anything else is a 404 before any fetch.
const posterFile = z.string().regex(TMDB_POSTER_FILE);

// Serves one TMDB thumbnail per validated file name, for the Add movie search results. The file name
// is the only input, and the upstream URL is fixed in getTmdbPoster. It is not a pass-through proxy.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const parsed = posterFile.safeParse((await params).file);
  if (!parsed.success) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const bytes = await getTmdbPoster(parsed.data);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        // TMDB file names are content-addressed, so a file never changes and a long cache is safe.
        "Cache-Control": "private, max-age=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[lookup-poster] ${error.message}`);
      return Response.json({ error: "poster unavailable" }, { status: 502 });
    }
    throw error;
  }
}
