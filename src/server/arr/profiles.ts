import "server-only";

/** A quality profile as a dropdown option. Radarr and Sonarr profiles both reduce to this. */
export type QualityProfileOption = { id: number; name: string };

/**
 * Profiles with an id and a name, as dropdown options. toMovieRows, toSeriesRows and the list functions
 * all use this, so the row labels and the filter options always agree on which profiles exist.
 * Structurally typed, so Radarr and Sonarr profile resources both fit.
 */
export function usableProfiles(profiles: { id?: number; name?: string | null }[]): QualityProfileOption[] {
  const options: QualityProfileOption[] = [];
  for (const profile of profiles) {
    if (typeof profile.id === "number" && profile.name) options.push({ id: profile.id, name: profile.name });
  }
  return options;
}

/** Upstream profiles, reduced to usable options and sorted by name. Shared by the Radarr and Sonarr list functions. */
export function sortedProfileOptions(profiles: { id?: number; name?: string | null }[]): QualityProfileOption[] {
  const options = usableProfiles(profiles);
  options.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return options;
}
