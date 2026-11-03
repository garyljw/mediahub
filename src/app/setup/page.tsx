import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PlexSignInButton } from "@/components/auth/plex-sign-in-button";
import { plexErrorMessage } from "@/components/auth/plex-messages";
import { getPlexAdminConfig } from "@/server/plex/admin-config";

// Block on the server, so the redirects below are real redirects. The page reads the database.
export const instant = false;

// Public on purpose: this is the first-run page, before any admin exists. It only starts a Plex sign-in.
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ plex?: string | string[] }>;
}) {
  // Makes the page render at request time, so the build doesn't need the database or env.
  await connection();
  if (getPlexAdminConfig() !== null) redirect("/login");

  const error = plexErrorMessage((await searchParams).plex);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Set up MediaHub</h1>
      <p className="text-sm text-muted-foreground">
        Sign in with the Plex account that owns your Plex server. That account becomes MediaHub&apos;s admin.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <PlexSignInButton />
    </main>
  );
}
