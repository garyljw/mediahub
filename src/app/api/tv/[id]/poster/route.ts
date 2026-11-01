import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { getSeriesPoster } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";

const seriesId = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .refine((n) => n <= 2147483647);

// Serves one fixed Sonarr file per validated series id. It is not a pass-through proxy:
// the path and filename are never taken from the request.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const parsed = seriesId.safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: "invalid id" }, { status: 400 });

  try {
    const bytes = await getSeriesPoster(parsed.data);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[poster] ${error.message}`);
      return Response.json({ error: "poster unavailable" }, { status: 502 });
    }
    throw error;
  }
}
