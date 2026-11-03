import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { readPendingSetup } from "@/server/plex/pending";
import { getPlexAdminConfig } from "@/server/plex/admin-config";
import { SETUP_COOKIE } from "@/server/plex/state";
import { ServerPicker } from "./server-picker";

// Block on the server, so the redirects below are real redirects. The page reads the database.
export const instant = false;

export default async function SetupServerPage() {
  await connection();
  if (getPlexAdminConfig() !== null) redirect("/login");

  const cookieStore = await cookies();
  const pending = await readPendingSetup(cookieStore.get(SETUP_COOKIE)?.value);
  if (!pending) redirect("/setup?plex=expired");

  // Only the names and ids go to the browser: no Plex account id, email or token.
  const servers = pending.servers.map(({ clientIdentifier, name }) => ({ clientIdentifier, name }));
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Choose your Plex server</h1>
      <p className="text-sm text-muted-foreground">MediaHub will only accept admin sign-ins from the account that owns this server.</p>
      <ServerPicker servers={servers} />
    </main>
  );
}
