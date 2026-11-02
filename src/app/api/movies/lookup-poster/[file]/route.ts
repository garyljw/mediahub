import "server-only";
import { connection } from "next/server";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { TMDB_POSTER_FILE, getTmdbPoster } from "@/server/arr/movie-add";
import { serveTmdbImageResponse } from "@/server/arr/poster";

// Serves one TMDB thumbnail per validated file name, for the Add movie search results. The file name
// is the only input, and the upstream URL is fixed in getTmdbPoster. It is not a pass-through proxy.
// Only a bare TMDB file name ("abc123.jpg") is accepted. Anything else is a 404 before any fetch.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  return serveTmdbImageResponse((await params).file, TMDB_POSTER_FILE, getTmdbPoster, "lookup-poster");
}
