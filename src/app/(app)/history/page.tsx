import { requirePageUser } from "@/server/authz";
import { fetchEpisodeHistory, fetchMovieHistory } from "@/server/arr/history";
import { settledOrNull } from "@/server/arr/request";
import { env } from "@/server/env";
import { radarrEventCodes, sonarrEventCodes, toHistoryEntries, type HistoryEntry } from "@/server/merge/history";
import { HistoryView } from "@/components/history/history-view";
import {
  MAX_HISTORY_LIMIT,
  parseHistoryParams,
  type HistoryParams,
  type RawHistorySearchParams,
} from "@/components/history/history-params";

export const metadata = { title: "History" };
export const instant = false;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<RawHistorySearchParams>;
}) {
  const user = await requirePageUser("admin", "requester");

  const params: HistoryParams = parseHistoryParams(await searchParams);
  const wantMovies = params.type !== "tv";
  const wantEpisodes = params.type !== "movies";

  const [movieResult, episodeResult] = await Promise.allSettled([
    wantMovies ? fetchMovieHistory(params.limit, radarrEventCodes(params.events)) : Promise.resolve(null),
    wantEpisodes ? fetchEpisodeHistory(params.limit, sonarrEventCodes(params.events)) : Promise.resolve(null),
  ]);
  const movies = settledOrNull(movieResult, "History page");
  const episodes = settledOrNull(episodeResult, "History page");

  const alerts: string[] = [];
  const moviesFailed = wantMovies && movies === null;
  const episodesFailed = wantEpisodes && episodes === null;
  if (moviesFailed && episodesFailed) {
    alerts.push("Couldn't load history from Radarr or Sonarr.");
  } else {
    if (moviesFailed) alerts.push("Couldn't load history from Radarr.");
    if (episodesFailed) alerts.push("Couldn't load history from Sonarr.");
  }

  const entries: HistoryEntry[] = toHistoryEntries(
    movies?.records ?? [],
    episodes?.records ?? [],
    params.limit,
    env().DISPLAY_TIMEZONE,
  );
  // Only the sides that loaded count. "Show more" is offered while more records exist and the cap isn't reached.
  const loadedTotal = (movies?.totalRecords ?? 0) + (episodes?.totalRecords ?? 0);
  const hasMore = loadedTotal > params.limit && params.limit < MAX_HISTORY_LIMIT;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <HistoryView
        entries={entries}
        params={params}
        hasMore={hasMore}
        canMarkFailed={user.role === "admin"}
        alerts={alerts}
      />
    </div>
  );
}
