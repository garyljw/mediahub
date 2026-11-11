import Link from "next/link";
import { requirePageUser } from "@/server/authz";
import { loadMovieAddOptions, loadSeriesAddOptions } from "@/server/add/add-options";
import { AddSearch } from "@/components/add/add-search";
import { parseAddParams } from "@/components/add/add-link";

export const metadata = { title: "Add" };
// The page waits for Radarr and Sonarr (admins only) before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] | undefined; kind?: string | string[] | undefined }>;
}) {
  const user = await requirePageUser("admin", "requester");
  const { query, kind } = parseAddParams(await searchParams);
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
      <AddSearch
        // A new start text gets a fresh search: the state is seeded from these props only once, and Next may reuse a
        // hidden Add page.
        key={`${kind}:${query}`}
        isAdmin={isAdmin}
        movieOptions={movieOptions}
        seriesOptions={seriesOptions}
        initialQuery={query}
        initialKind={kind}
      />
    </div>
  );
}
