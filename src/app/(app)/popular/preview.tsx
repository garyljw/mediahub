import "server-only";
import Link from "next/link";
import { TmdbRequestError, tmdbFailureFor } from "@/server/tmdb/errors";

// Shared by the two Popular preview pages (a TMDB movie or show that isn't in the library).

/** A heading with a "← Popular" link and a message, for the cases where there is nothing to preview. */
export function PreviewNotice({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div className="space-y-4">
      <Link href="/popular" className="text-sm text-muted-foreground hover:underline">
        ← Popular
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Popular</h1>
      <p role={alert ? "alert" : undefined} className={alert ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
        {children}
      </p>
    </div>
  );
}

/** The notice for a page with no saved TMDB token, worded as on Popular. */
export function NotSetUp({ isAdmin }: { isAdmin: boolean }) {
  return (
    <PreviewNotice>
      {isAdmin ? (
        <>
          <Link href="/settings/connections" className="text-primary underline">
            Add a TMDB token in Settings → Connections
          </Link>{" "}
          to see what&apos;s popular.
        </>
      ) : (
        "Popular isn't set up yet."
      )}
    </PreviewNotice>
  );
}

/** The notice for a failed TMDB request. A non-TMDB error is rethrown. The log line holds only the safe message. */
export function failureNotice(error: unknown, isAdmin: boolean) {
  if (!(error instanceof TmdbRequestError)) throw error;
  console.error(`Popular preview: ${error.message}`);
  const refused = error.kind === "http" && error.status === 401;
  return (
    <PreviewNotice alert>
      {tmdbFailureFor(error, isAdmin)}
      {refused && isAdmin && (
        <>
          {" "}
          <Link href="/settings/connections" className="underline">
            Open Settings
          </Link>
        </>
      )}
    </PreviewNotice>
  );
}
