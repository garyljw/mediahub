import { requirePageUser } from "@/server/authz";
import { getUpdatesView } from "@/server/updater/app-view";
import { UpdateCheckButton } from "@/components/settings/update-check-button";

export const metadata = { title: "Updates" };
export const instant = false;

export default async function UpdatesPage() {
  await requirePageUser("admin");
  const view = getUpdatesView();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
      <p className="mt-2 text-sm text-muted-foreground">Installed version: {view.runningVersion}</p>

      {!view.available ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Automatic updates work only in the Windows installer version of MediaHub.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Latest version</dt>
            <dd>
              {view.latestVersion
                ? `Version ${view.latestVersion} is available.`
                : view.lastResult?.kind === "up-to-date" || view.lastResult?.kind === "installed"
                  ? "MediaHub is up to date."
                  : view.lastChecked === null
                    ? "Not checked yet"
                    : "—"}
            </dd>
            <dt className="text-muted-foreground">Last checked</dt>
            <dd>{view.lastChecked ?? "Not checked yet"}</dd>
            {view.lastResult && (
              <>
                <dt className="text-muted-foreground">Last result</dt>
                <dd>
                  {view.lastResult.message} <span className="text-muted-foreground">({view.lastResult.at})</span>
                </dd>
              </>
            )}
          </dl>

          {view.state === "checking" && (
            <p role="status" className="text-sm">
              Checking for updates…
            </p>
          )}
          {view.state === "installing" && (
            <p role="status" className="text-sm">
              An update is being installed. MediaHub will stop for a minute or two; reload this page afterwards.
            </p>
          )}
          {view.skipped.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Not retried overnight: {view.skipped.join(", ")}. Check for updates now tries again.
            </p>
          )}
          {view.checkQueued && (
            <p role="status" className="text-sm">
              A check is queued. The updater picks it up within a few minutes.
            </p>
          )}

          <UpdateCheckButton queued={view.checkQueued} checking={view.state === "checking"} />

          <p className="text-sm text-muted-foreground">
            Overnight updates run 03:00–04:00 PC time. To turn them off, set <code>MEDIAHUB_AUTO_UPDATE=false</code> in{" "}
            <code>C:\ProgramData\MediaHub\mediahub.env</code>.
          </p>
        </div>
      )}
    </div>
  );
}
