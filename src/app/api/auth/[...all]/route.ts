import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// Handlers are built per request so that env() is never evaluated at import/build time.
export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
