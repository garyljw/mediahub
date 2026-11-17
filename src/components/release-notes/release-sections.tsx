import type { ReleaseSection } from "@/content/release-notes";
import { BoldText } from "@/components/release-notes/bold-text";

export function ReleaseSections({ sections }: { sections: ReleaseSection[] }) {
  return (
    <>
      {sections.map((section) => (
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
    </>
  );
}
