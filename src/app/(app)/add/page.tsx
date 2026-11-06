import Link from "next/link";
import { requirePageUser } from "@/server/authz";
import { loadMovieAddOptions, loadSeriesAddOptions } from "@/server/add/add-options";
import { AddSearch } from "@/components/add/add-search";

export const metadata = { title: "Add" };
// The page waits for Radarr and Sonarr (admins only) before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function AddPage() {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  // Requesters load nothing from Arr. Admins load each app separately, so one app's failure doesn't hide the other.
  const [movieOptions, seriesOptions] = isAdmin
    ? await Promise.all([loadMovieAddOptions("Add page"), loadSeriesAddOptions("Add page")])
    : [null, null];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add</h1>
      <AddSearch isAdmin={isAdmin} movieOptions={movieOptions} seriesOptions={seriesOptions} />
    </div>
  );
}
