// The shared layout for the movie and series pages. No "use client": both pages are server components, and the
// interactive pieces (backdrop, actions) are client components of their own. The section order is fixed here, so
// the two pages can't drift apart. Type-specific content comes in through the slots.
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Backdrop } from "@/components/poster/backdrop";
import { PosterTile } from "@/components/poster/poster";
import { ExternalLinks, Fact } from "@/components/library/detail-parts";
import { MonitoredIcon } from "@/components/library/monitored-icon";
import { PosterWash, PosterWashLayer } from "@/components/poster/poster-wash";

export type ItemPageProps = {
  title: string;
  year: number | null;
  /** The grey line under the title, e.g. certification, runtime and genres. Null leaves it out. */
  meta: string | null;
  /** Plain lines under the meta line, e.g. directors or ratings. The page leaves out the missing ones. */
  extraLines: string[];
  backdropSrc: string | null;
  posterSrc: string | null;
  /** The status badge's text and classes, each page's own. */
  status: { label: string; className: string };
  monitored: boolean;
  qualityProfile: string;
  overview: string;
  /** The page's action bar, e.g. Search and admin buttons. */
  actions: ReactNode;
  /** A live queue line under the actions. */
  activity: ReactNode;
  /** The section after the hero: Cast on a movie, Seasons on a series. */
  typeSection: ReactNode;
  /** The eight facts in the Details grid, in order. */
  facts: { label: string; value: ReactNode }[];
  /** External site links. An entry with a null url is left out. */
  links: { label: string; url: string | null }[];
  /** The admin-only Settings card. Null hides the card. */
  settings: ReactNode | null;
};

export function ItemPageLayout({
  title,
  year,
  meta,
  extraLines,
  backdropSrc,
  posterSrc,
  status,
  monitored,
  qualityProfile,
  overview,
  actions,
  activity,
  typeSection,
  facts,
  links,
  settings,
}: ItemPageProps) {
  return (
    <PosterWash posterSrc={posterSrc} className="space-y-6">
      {/* Home is the one library page, so every item page goes back there. */}
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>

      <section className="relative overflow-hidden rounded-xl border bg-card/60 backdrop-blur-sm">
        {backdropSrc !== null && <Backdrop src={backdropSrc} />}
        {/* The poster's glow inside the card too: over the backdrop, behind the text. */}
        <PosterWashLayer />
        <div className="relative flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
          {/* self-start keeps the box at the poster's own height (a flex row would stretch it to the text column), so the tilt
              and shadow fit the poster. Every poster tilts; the shadow takes the poster's colour only when it has a wash. */}
          <div className="w-32 shrink-0 -rotate-[1.5deg] self-start rounded-md shadow-lg in-data-[washed]:shadow-[0_30px_60px_-18px_oklch(0.55_0.2_var(--h1)/.8)] sm:w-40 md:w-48">
            <PosterTile src={posterSrc} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {title}
              {year !== null && <span className="ml-2 font-normal text-muted-foreground">{year}</span>}
            </h1>
            {meta !== null && <p className="text-sm text-muted-foreground">{meta}</p>}
            {extraLines.map((line, index) => (
              <p key={index} className="text-sm">
                {line}
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Badge variant="outline" className={status.className}>
                {status.label}
              </Badge>
              <span className="inline-flex items-center gap-1">
                <MonitoredIcon monitored={monitored} />
                <span>{monitored ? "Monitored" : "Unmonitored"}</span>
              </span>
              <span className="text-muted-foreground">Profile: {qualityProfile}</span>
            </div>
            {overview !== "" && <p className="max-w-prose text-sm">{overview}</p>}
            {actions}
            {activity}
          </div>
        </div>
      </section>

      {typeSection}

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          {facts.map((fact) => (
            <Fact key={fact.label} label={fact.label}>
              {fact.value}
            </Fact>
          ))}
        </dl>
        <ExternalLinks links={links} />
      </section>

      {settings !== null && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          {settings}
        </section>
      )}
    </PosterWash>
  );
}
