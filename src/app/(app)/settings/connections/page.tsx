import { requirePageUser } from "@/server/authz";
import { getPlexAdminConfig } from "@/server/plex/admin-config";
import { getPlexDataSummary } from "@/server/plex/data-connection";
import { getConnectionSummary, type ArrApp } from "@/server/settings/connections";
import { ConnectionForm } from "@/components/settings/connection-form";
import { PlexConnectionForm } from "@/components/settings/plex-connection-form";

export const metadata = { title: "Connections" };
export const instant = false;

const APPS: { app: ArrApp; name: string }[] = [
  { app: "radarr", name: "Radarr" },
  { app: "sonarr", name: "Sonarr" },
];

export default async function ConnectionsPage() {
  await requirePageUser("admin");
  // Only what the forms need crosses to the browser: never the stored keys or the Plex token.
  const plex = getPlexDataSummary();
  const plexSetUp = getPlexAdminConfig() !== null;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Where MediaHub reaches Radarr, Sonarr and Plex. API keys and the Plex token are stored on the server and never
        shown again.
      </p>
      <div className="mt-6 space-y-6">
        {APPS.map(({ app, name }) => {
          const { url, hasKey } = getConnectionSummary(app);
          return (
            <section key={app} className="rounded-lg border p-5">
              <h2 className="text-lg font-semibold">{name}</h2>
              <div className="mt-4">
                <ConnectionForm app={app} url={url} hasKey={hasKey} />
              </div>
            </section>
          );
        })}
        <section className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Plex</h2>
          <div className="mt-4">
            {plexSetUp ? (
              <PlexConnectionForm connected={plex.connected} url={plex.url} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Finish Plex sign-in setup first. Then connect the Plex server here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
