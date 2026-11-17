import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { requirePageUser } from "@/server/authz";
import { appVersion } from "@/server/app-version";
import { noticesSummary } from "@/server/notices";
import { RELEASE_NOTES } from "@/content/release-notes";
import { ReleaseSections } from "@/components/release-notes/release-sections";
import { formatAdded } from "@/components/library/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "About" };
// Reads the session per request (requirePageUser). Block on the server, as the (app) layout does.
export const instant = false;

const cardClass = "mt-6 rounded-xl border bg-card p-5";
const headingClass = "text-lg font-semibold tracking-tight";

export default async function AboutPage() {
  await requirePageUser("admin", "requester");
  const licences = noticesSummary();
  const version = appVersion();
  // Notes for the running version (a release candidate uses its release's notes), else the newest entry.
  const baseVersion = version.replace(/-rc\.\d+$/, "");
  const latest = RELEASE_NOTES.find((r) => r.version === baseVersion) ?? RELEASE_NOTES[0];

  return (
    <div>
      <div className="flex items-center gap-4">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand text-white glow-brand">
          <LayoutGrid className="size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="bg-brand bg-clip-text [-webkit-background-clip:text] font-display text-3xl font-bold tracking-tight text-transparent">
            MediaHub
          </h1>
          <p className="text-sm text-muted-foreground">Version {version}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">A hobby project for personal use, maintained in spare time.</p>

      <section className={cardClass}>
        <h2 className={headingClass}>What MediaHub does</h2>
        <p className="mt-2 text-sm">
          MediaHub puts the movies in Radarr and the TV in Sonarr in one place. Browse your whole library, find and add new titles, see what&apos;s downloading in the Queue, Calendar and History, and keep Movie Focus and TV Focus lists that MediaHub keeps in step with collections in Plex. With Plex connected it also shows what you&apos;ve watched, and with a TMDB token it shows what&apos;s popular and who&apos;s in the cast.
        </p>
      </section>

      {latest && (
        <section className={cardClass}>
          <h2 className={headingClass}>
            What&apos;s new in {latest.version}
            <span className="ml-3 text-sm font-normal text-muted-foreground">{formatAdded(latest.date)}</span>
          </h2>
          <ReleaseSections sections={latest.sections} />
          <p className="mt-4 text-sm">
            <Link href="/release-notes" className="text-primary hover:underline">
              All release notes
            </Link>
          </p>
        </section>
      )}

      <section className={cardClass}>
        <h2 className={headingClass}>Report a problem or idea</h2>
        <p className="mt-2 text-sm">
          Found a bug or have an idea? Open an issue on GitHub. You need a free GitHub account. Issues are public, so don&apos;t include addresses, API keys or other personal details.
        </p>
        <p className="mt-2 text-sm">
          <a href="https://github.com/garyljw/mediahub/issues/new" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Open a new issue on GitHub
          </a>
        </p>
        <p className="mt-2 text-sm">
          <a href="https://github.com/garyljw/mediahub" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Source code on GitHub
          </a>
        </p>
        <p className="mt-2 text-sm">MediaHub is released under the MIT licence.</p>
      </section>

      <section className={cardClass}>
        <h2 className={headingClass}>TMDB</h2>
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="mt-3 inline-block">
          {/* TMDB's own logo, unaltered, as their attribution rules ask. A plain img: it is a small static file. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" width={245} height={18} className="h-[18px] w-auto" />
        </a>
        <p className="mt-3 text-sm text-muted-foreground">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </section>

      <section className={cardClass}>
        <h2 className={headingClass}>Open-source licences</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MediaHub is built on the open-source projects listed below, each under its own licence.
        </p>
        {/* The texts come from the same packaging step as the list, so the link only shows when the list does. */}
        {licences !== null && (
          <p className="mt-2 text-sm">
            <a href="/api/about/licences" className="text-primary hover:underline">
              Read the full licence texts
            </a>
          </p>
        )}

        {licences === null ? (
          <p className="mt-4 text-sm text-muted-foreground">
            The licence list is created when MediaHub is packaged, so it isn&apos;t available in development.
          </p>
        ) : (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-primary hover:underline">
              Show the list ({licences.length} projects)
            </summary>
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Licence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {licences.map((item) => (
                    <TableRow key={`${item.name}@${item.version}`}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.version}</TableCell>
                      <TableCell className="text-muted-foreground">{item.licence}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
