"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { chipClass } from "@/components/library/chip";
import { PosterTile } from "@/components/poster/poster";
import { POSTER_GRID_CLASS, POSTER_TILE_CLASS } from "@/components/poster/poster-grid";
import type { Filmography, FilmographyTile } from "@/server/merge/filmography";

type Kind = "all" | "movie" | "tv";

const KIND_CHIPS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "movie", label: "Movies" },
  { kind: "tv", label: "TV" },
];

function episodesText(count: number): string {
  return count === 1 ? "1 episode" : `${count} episodes`;
}

/** The year, and in the mixed list "TV" for a show, so the two kinds can be told apart. */
function yearLine(tile: FilmographyTile, mixed: boolean): string | null {
  const parts = [tile.year === null ? null : String(tile.year), mixed && tile.kind === "tv" ? "TV" : null];
  const shown = parts.filter((part): part is string => part !== null);
  return shown.length === 0 ? null : shown.join(" · ");
}

/**
 * A person's acting credits as a poster grid, with an All / Movies / TV toggle styled like Home's kind chips. All mixes
 * the two newest first. The toggle is left out when the person has only one kind. Each tile opens the title's page.
 */
export function FilmographyView({ tiles: allTiles }: { tiles: Filmography["tiles"] }) {
  const [chosen, setKind] = useState<Kind>("all");
  const both = allTiles.some((tile) => tile.kind === "movie") && allTiles.some((tile) => tile.kind === "tv");
  // With only one kind there is no toggle, so a choice left over from another person can't hide everything.
  const kind = both ? chosen : "all";
  const tiles = kind === "all" ? allTiles : allTiles.filter((tile) => tile.kind === kind);
  const mixed = both && kind === "all";

  return (
    <div className="space-y-3">
      {both && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {KIND_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              aria-pressed={kind === chip.kind}
              onClick={() => setKind(chip.kind)}
              className={chipClass(kind === chip.kind)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      <ul className={POSTER_GRID_CLASS}>
        {tiles.map((tile) => {
          const year = yearLine(tile, mixed);
          return (
            <li key={tile.key} className={POSTER_TILE_CLASS}>
              <Link
                href={tile.href}
                draggable={false}
                className="group block rounded-lg hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <PosterTile src={tile.posterFile === null ? null : `/api/movies/lookup-poster/${tile.posterFile}`} />
                <p className="mt-1.5 truncate text-sm font-medium leading-snug" title={tile.title}>
                  {tile.title}
                </p>
                {year !== null && <p className="text-xs text-muted-foreground">{year}</p>}
                {tile.character !== null && <p className="line-clamp-2 text-xs text-muted-foreground">{tile.character}</p>}
                {tile.episodes !== null && <p className="text-xs text-muted-foreground">{episodesText(tile.episodes)}</p>}
              </Link>
              {tile.inLibrary && (
                <Badge variant="secondary" className="mt-1.5">
                  In library
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
