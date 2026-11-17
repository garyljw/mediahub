import { requirePageUser } from "@/server/authz";
import { RELEASE_NOTES } from "@/content/release-notes";
import { ReleaseSections } from "@/components/release-notes/release-sections";
import { formatAdded } from "@/components/library/format";

export const metadata = { title: "Release notes" };
// Reads the session per request (requirePageUser). Block on the server, as the (app) layout does.
export const instant = false;

export default async function ReleaseNotesPage() {
  await requirePageUser("admin", "requester");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Release notes</h1>

      {RELEASE_NOTES.map((release) => (
        <section key={release.version} className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            MediaHub {release.version}
            <span className="ml-3 text-sm font-normal text-muted-foreground">{formatAdded(release.date)}</span>
          </h2>
          <ReleaseSections sections={release.sections} />
        </section>
      ))}
    </div>
  );
}
