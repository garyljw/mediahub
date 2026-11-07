import "server-only";
import { connection } from "next/server";
import { authzErrorResponse, requireRole } from "@/server/authz";
import { noticesText } from "@/server/notices";

// The full licence texts (THIRD_PARTY_NOTICES.txt), linked from the About page. Takes no input, so there is nothing
// to validate. Admins and requesters both may read it, the same as the About page.
const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  await connection();
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    return authzErrorResponse(error);
  }

  const text = noticesText();
  if (text === null) {
    return new Response("The licence list is not in this build of MediaHub.", { status: 404, headers: HEADERS });
  }
  return new Response(text, { headers: HEADERS });
}
