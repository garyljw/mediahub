import Link from "next/link";
import { PopularServicesForm } from "@/components/settings/popular-services-form";
import { requirePageUser } from "@/server/authz";
import { mergeServices } from "@/server/merge/popular";
import { getChosenServices, getTmdbConfig } from "@/server/settings/tmdb";
import { getProviders, TmdbRequestError } from "@/server/tmdb/client";
import { Breadcrumb } from "@/components/breadcrumb/breadcrumb";
import { navCrumb } from "@/components/breadcrumb/trail";

export const metadata = { title: "Popular" };
// The page waits for TMDB before rendering; the Settings loading.tsx shows a placeholder meanwhile.
export const instant = false;

function Heading() {
  return (
    <>
      <div className="mb-4">
        <Breadcrumb label="Popular" root={navCrumb("/settings")} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Popular</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick the streaming services the Popular page offers, and drag them into order. With none picked, it shows
        TMDB&apos;s top 12 for your country.
      </p>
    </>
  );
}

export default async function PopularSettingsPage() {
  await requirePageUser("admin");
  const config = getTmdbConfig();
  if (config === null) {
    return (
      <div>
        <Heading />
        <div className="mt-6 space-y-2">
          <p className="text-sm text-muted-foreground">Add a TMDB token in Settings → Connections first.</p>
          <Link href="/settings/connections" className="text-sm font-medium underline">
            Go to Connections
          </Link>
        </div>
      </div>
    );
  }

  let services;
  try {
    const [movie, tv] = await Promise.all([
      getProviders(config.token, "movie", config.region),
      getProviders(config.token, "tv", config.region),
    ]);
    // Only {id, name} cross to the browser.
    services = mergeServices(movie, tv, config.region).map(({ id, name }) => ({ id, name }));
  } catch (error) {
    if (!(error instanceof TmdbRequestError)) throw error;
    // TmdbRequestError messages never contain the host, token, URL or response body, so they are safe to log.
    console.error(`Popular settings page: ${error.message}`);
    return (
      <div>
        <Heading />
        <p role="alert" className="mt-6 text-sm text-destructive">
          Couldn&apos;t load the services from TMDB.
        </p>
      </div>
    );
  }

  // Stored ids TMDB no longer offers are left out here, and drop off the list on the next save.
  const known = new Set(services.map((s) => s.id));
  const initialIds = getChosenServices().filter((id) => known.has(id));

  return (
    <div>
      <Heading />
      <div className="mt-6">
        <PopularServicesForm services={services} initialIds={initialIds} />
      </div>
    </div>
  );
}
