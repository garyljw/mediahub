import { requirePageUser } from "@/server/authz";
import { getConnectionSummary, type ArrApp } from "@/server/settings/connections";
import { ConnectionForm } from "@/components/settings/connection-form";

export const metadata = { title: "Connections" };
export const instant = false;

const APPS: { app: ArrApp; name: string }[] = [
  { app: "radarr", name: "Radarr" },
  { app: "sonarr", name: "Sonarr" },
];

export default async function ConnectionsPage() {
  await requirePageUser("admin");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Where MediaHub reaches Radarr and Sonarr. API keys are stored on the server and never shown again.
      </p>
      <div className="mt-6 space-y-6">
        {APPS.map(({ app, name }) => {
          // Only what the form needs crosses to the browser: never the stored key.
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
      </div>
    </div>
  );
}
