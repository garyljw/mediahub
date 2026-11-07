import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { getSeriesPeek } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";

const NO_STORE = { "Cache-Control": "no-store" };
// A hover card may be shown again within five minutes without asking MediaHub again.
const PEEK_CACHE = { "Cache-Control": "private, max-age=300" };

// Plain digits only, and a positive id. The same rule as the activity routes.
const seriesId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

// Read when a poster is hovered on Home and on the Focus pages. Takes only the series id from the path, and sends
// back only the three fields a hover card shows (see toPeek in src/server/merge/peek.ts).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const parsed = seriesId.safeParse((await params).id);
  if (!parsed.success) {
    return Response.json({ error: "invalid id" }, { status: 400, headers: NO_STORE });
  }

  try {
    const peek = await getSeriesPeek(parsed.data);
    return Response.json({ peek }, { headers: PEEK_CACHE });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[series-peek] ${error.message}`);
      return Response.json({ error: "peek unavailable" }, { status: 502, headers: NO_STORE });
    }
    throw error;
  }
}
