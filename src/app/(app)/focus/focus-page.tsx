import { AlertTriangle } from "lucide-react";
import { listMovies, type MovieRow } from "@/server/arr/movies";
import { listSeries, type SeriesRow } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { loadMovieAddOptions, loadSeriesAddOptions } from "@/server/add/add-options";
import { getWatchedIndex } from "@/server/plex/watched";
import type { WatchedIndex } from "@/server/merge/watched";
import { listFocusIds } from "@/server/focus/focus";
import { toHomeItems } from "@/server/merge/library";
import type { HomeItem } from "@/components/home/home-items";
import { FocusAdd } from "@/components/focus/focus-add";
import { FocusGrid } from "@/components/focus/focus-grid";
import { FOCUS_APP, FOCUS_NAME, type FocusKind } from "@/components/focus/focus-kinds";

// The shared body of /focus/movies and /focus/tv. Each page checks its roles with requirePageUser before rendering this.
// Only the kind's own app is loaded, so a Radarr id never produces a TV tile and the other way round. Nothing here
// writes to the database: titles that are no longer in the library are shown with a notice, and the user removes them.

const NOUN: Record<FocusKind, string> = { movie: "movie", series: "show" };

/** One app's library rows. The kind says which app they came from, so the rows never mix. */
type Library = { kind: "movie"; rows: MovieRow[] } | { kind: "series"; rows: SeriesRow[] };

/** Loads only the kind's own app. An Arr request failure gives null, which the page shows as an error. */
async function loadLibrary(kind: FocusKind): Promise<Library | null> {
  if (kind === "movie") {
    const movies = await loadOrNull(listMovies, "Focus page");
    return movies === null ? null : { kind, rows: movies.rows };
  }
  const series = await loadOrNull(listSeries, "Focus page");
  return series === null ? null : { kind, rows: series.rows };
}

/** The library ids, as numbers, for the missing-title check. */
function libraryIds(library: Library): Set<number> {
  const rows: { id: number }[] = library.rows;
  return new Set(rows.map((row) => row.id));
}

/** Home items for every title in the loaded library, sorted as on Home. The page splits them into tiles and candidates. */
function libraryItems(library: Library, watched: WatchedIndex | null): HomeItem[] {
  if (library.kind === "movie") return toHomeItems(library.rows, [], watched);
  return toHomeItems([], library.rows, watched);
}

export async function FocusListPage({ kind, isAdmin }: { kind: FocusKind; isAdmin: boolean }) {
  const name = FOCUS_NAME[kind];
  const app = FOCUS_APP[kind];
  // The full stored order, including titles no longer in the library. The grid sends it back whole on a reorder.
  const allIds = listFocusIds(kind);
  const stored = new Set(allIds);

  // Plex is not wrapped in loadOrNull: a failure only costs the watched banners, as on Home. Admins load the kind's
  // add options for the panel in the same wait. Requesters load none.
  const [library, watched, movieOptions, seriesOptions] = await Promise.all([
    loadLibrary(kind),
    getWatchedIndex(),
    isAdmin && kind === "movie" ? loadMovieAddOptions("Focus page") : null,
    isAdmin && kind === "series" ? loadSeriesAddOptions("Focus page") : null,
  ]);
  const watchedIndex = watched === "failed" ? null : watched;

  // Missing titles are only known when the library loaded. Nothing is removed automatically.
  const items = library === null ? null : libraryItems(library, watchedIndex);
  const tiles = items === null ? null : items.filter((item) => stored.has(item.id));
  const candidates = items === null ? [] : items.filter((item) => !stored.has(item.id));
  const present = library === null ? null : libraryIds(library);
  const missing = present === null ? [] : allIds.filter((id) => !present.has(id));
  const byId = new Map((tiles ?? []).map((item) => [item.id, item]));
  const visible = allIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
      {tiles === null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load {kind === "movie" ? "movies" : "TV"} from {app}.
        </p>
      )}
      {watched === "failed" && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Couldn&apos;t load watched status from Plex.
        </p>
      )}
      {library !== null && (
        <FocusAdd
          kind={kind}
          isAdmin={isAdmin}
          candidates={candidates}
          movieOptions={movieOptions}
          seriesOptions={seriesOptions}
        />
      )}
      {tiles !== null && allIds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing in {name} yet. Search above to add a {NOUN[kind]}, or right-click a {NOUN[kind]} on Home (or press and hold)
          and choose Add to {name}.
        </p>
      )}
      {tiles !== null && allIds.length > 0 && (
        <FocusGrid kind={kind} items={visible} allIds={allIds} missing={missing} />
      )}
    </div>
  );
}
