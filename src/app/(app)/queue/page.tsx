import { requirePageUser } from "@/server/authz";
import { fetchEpisodeQueue, fetchMovieQueue } from "@/server/arr/queue";
import { settledOrNull } from "@/server/arr/request";
import { toQueueRows, type QueueRow } from "@/server/merge/queue";
import { QueueView } from "@/components/queue/queue-view";
import type { QueueFailures } from "@/components/queue/queue-rows";

export const metadata = { title: "Queue" };
// The page waits for Radarr and Sonarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

/**
 * The queue rows from both apps, and which side's request failed. The view decides what to show for a failed side
 * (its last known rows, or a load error). ETAs are measured here, on the server.
 */
async function loadQueue(showDetails: boolean): Promise<{ rows: QueueRow[]; failed: QueueFailures }> {
  const [movieResult, episodeResult] = await Promise.allSettled([
    fetchMovieQueue({ includeMovie: true }),
    fetchEpisodeQueue({ includeSeries: true, includeEpisode: true }),
  ]);
  const movies = settledOrNull(movieResult, "Queue page");
  const episodes = settledOrNull(episodeResult, "Queue page");
  const rows = toQueueRows(movies ?? [], episodes ?? [], Date.now(), { includeDetails: showDetails });
  return { rows, failed: { radarr: movies === null, sonarr: episodes === null } };
}

export default async function QueuePage() {
  const user = await requirePageUser("admin", "requester");
  const showDetails = user.role === "admin";
  const { rows, failed } = await loadQueue(showDetails);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
      <QueueView rows={rows} failed={failed} showDetails={showDetails} canRemove={user.role === "admin"} />
    </div>
  );
}
