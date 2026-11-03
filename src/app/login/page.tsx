import Link from "next/link";
import { redirect } from "next/navigation";
import { PlexSignInButton } from "@/components/auth/plex-sign-in-button";
import { plexErrorMessage } from "@/components/auth/plex-messages";
import { getSession } from "@/server/authz";
import { getPlexAdminConfig } from "@/server/plex/admin-config";
import { LoginForm } from "./login-form";

// Reads the session to redirect signed-in users. Block on the server for a real redirect.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ plex?: string | string[] }>;
}) {
  if (await getSession()) redirect("/");

  const configured = getPlexAdminConfig() !== null;
  const error = plexErrorMessage((await searchParams).plex);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in to MediaHub</h1>
      {!configured && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            MediaHub isn&apos;t set up yet. The admin sets it up by signing in with Plex.
          </p>
          <Link
            href="/setup"
            className="block rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
          >
            Set up with Plex
          </Link>
        </div>
      )}
      {configured && <PlexSignInButton label="Admin: sign in with Plex" />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <LoginForm />
    </main>
  );
}
