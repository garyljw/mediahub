import { requirePageUser } from "@/server/authz";
import { RELEASE_NOTES } from "@/content/release-notes";
import { BoldText } from "@/components/release-notes/bold-text";
import { formatAdded } from "@/components/library/format";

export const metadata = { title: "Release notes" };

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
          {release.sections.map((section) => (
            <div key={section.heading} className="mt-4">
              <h3 className="text-sm font-semibold">{section.heading}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {section.notes.map((note, i) => (
                  <li key={i}>
                    <BoldText text={note.text} />
                    {note.details && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        {note.details.map((detail, j) => (
                          <li key={j}>
                            <BoldText text={detail} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
