import "server-only";
import { z } from "zod";

// Reply shapes for the TMDB calls MediaHub makes. Each keeps only the fields we use; unknown fields are dropped.
// Posters and dates can be null or an empty string, so both are normalised to null.

// Genres the Popular page leaves out (TMDB genre ids): documentaries in movies and TV, and for TV also News (10763),
// Reality (10764, which is where TMDB files quiz and game shows), Soap (10766) and Talk (10767). One source for both the
// upstream filters and the merge that drops them from lists TMDB can't filter.
export const EXCLUDED_MOVIE_GENRES: readonly number[] = [99];
export const EXCLUDED_TV_GENRES: readonly number[] = [99, 10763, 10764, 10766, 10767];

const emptyToNull = (value: string | null | undefined): string | null => (value ? value : null);
const optionalText = z.string().nullish().transform((v) => emptyToNull(v));

const genreIds = z.array(z.number().int()).nullish().transform((v) => v ?? []);

const MovieResult = z.object({
  id: z.number().int(),
  title: z.string(),
  release_date: optionalText,
  overview: z.string().nullish().transform((v) => v ?? ""),
  poster_path: optionalText,
  genre_ids: genreIds,
});

const TvResult = z.object({
  id: z.number().int(),
  name: z.string(),
  first_air_date: optionalText,
  overview: z.string().nullish().transform((v) => v ?? ""),
  poster_path: optionalText,
  genre_ids: genreIds,
});

export type TmdbMovie = { id: number; title: string; releaseDate: string | null; overview: string; posterPath: string | null; genreIds: number[] };
export type TmdbShow = { id: number; name: string; firstAirDate: string | null; overview: string; posterPath: string | null; genreIds: number[] };
export type TmdbProvider = { id: number; name: string; logoPath: string | null; displayPriority: number; displayPriorities: Record<string, number> };
export type TmdbRegion = { code: string; name: string };

export const AuthenticationSchema = z.object({ success: z.literal(true) });

export const MovieListSchema = z
  .object({ results: z.array(MovieResult) })
  .transform(({ results }): TmdbMovie[] =>
    results.map((m) => ({
      id: m.id,
      title: m.title,
      releaseDate: m.release_date,
      overview: m.overview,
      posterPath: m.poster_path,
      genreIds: m.genre_ids,
    })),
  );

export const TvListSchema = z
  .object({ results: z.array(TvResult) })
  .transform(({ results }): TmdbShow[] =>
    results.map((s) => ({
      id: s.id,
      name: s.name,
      firstAirDate: s.first_air_date,
      overview: s.overview,
      posterPath: s.poster_path,
      genreIds: s.genre_ids,
    })),
  );

export const ProvidersSchema = z
  .object({
    results: z.array(
      z.object({
        provider_id: z.number().int(),
        provider_name: z.string(),
        logo_path: optionalText,
        display_priorities: z.record(z.string(), z.number()).nullish().transform((v) => v ?? {}),
        display_priority: z.number().nullish().transform((v) => v ?? Number.MAX_SAFE_INTEGER),
      }),
    ),
  })
  .transform(({ results }): TmdbProvider[] =>
    results.map((p) => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path, displayPriority: p.display_priority, displayPriorities: p.display_priorities })),
  );

/** Genre id to name, for the hover card. */
export const GenresSchema = z
  .object({ genres: z.array(z.object({ id: z.number().int(), name: z.string() })) })
  .transform(({ genres }): Map<number, string> => new Map(genres.map((g) => [g.id, g.name])));

export const RegionsSchema = z
  .object({ results: z.array(z.object({ iso_3166_1: z.string().regex(/^[A-Z]{2}$/), english_name: z.string() })) })
  .transform(({ results }): TmdbRegion[] =>
    results.map((r) => ({ code: r.iso_3166_1, name: r.english_name })).sort((a, b) => a.name.localeCompare(b.name)),
  );

/** tvdb_id may be null or missing: the caller treats that as "can't add". */
export const ExternalIdsSchema = z
  .object({ tvdb_id: z.number().int().positive().nullish() })
  .transform(({ tvdb_id }) => ({ tvdbId: tvdb_id ?? null }));

// Detail pages. Everything optional is tolerated as null or "" (TMDB sends both). Image paths are reduced to a bare
// ".jpg" file name for MediaHub's own image routes, and anything of another shape is dropped.

const MAX_CAST = 20;
const IMAGE_FILE = /^[A-Za-z0-9]{1,64}\.jpg$/;

function imageFile(path: string | null | undefined): string | null {
  const file = path?.replace(/^\//, "") ?? "";
  return IMAGE_FILE.test(file) ? file : null;
}

const text = z.string().nullish().transform((v) => (v ? v : null));
const genreList = z
  .array(z.object({ name: z.string() }))
  .nullish()
  .transform((v) => (v ?? []).map((g) => g.name).filter((name) => name !== ""));
const imdbId = z
  .string()
  .nullish()
  .transform((v) => (v && /^tt\d+$/.test(v) ? v : null));

export type TmdbCastMember = { id: number; name: string; character: string | null; episodes: number | null; photo: string | null };

export type TmdbMovieDetails = {
  id: number;
  title: string;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  overview: string;
  tagline: string | null;
  posterFile: string | null;
  backdropFile: string | null;
  imdbId: string | null;
  directors: string[];
  cast: TmdbCastMember[];
};

export type TmdbShowDetails = {
  id: number;
  name: string;
  firstAirDate: string | null;
  seasons: number | null;
  episodes: number | null;
  /** Minutes per episode: the show's own figure, else the last aired episode's, else null. */
  runtime: number | null;
  genres: string[];
  overview: string;
  tagline: string | null;
  posterFile: string | null;
  backdropFile: string | null;
  status: string | null;
  networks: string[];
  createdBy: string[];
  cast: TmdbCastMember[];
};

const positiveOrNull = z.number().positive().nullish().transform((v) => v ?? null);
const names = z
  .array(z.object({ name: z.string().nullish() }))
  .nullish()
  .transform((v) => (v ?? []).map((n) => n.name?.trim() ?? "").filter((name) => name !== ""));

export const MovieDetailsSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    release_date: optionalText,
    runtime: positiveOrNull,
    genres: genreList,
    overview: z.string().nullish().transform((v) => v ?? ""),
    tagline: text,
    poster_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    imdb_id: imdbId,
    credits: z
      .object({
        cast: z
          .array(
            z.object({
              id: z.number().int(),
              name: z.string(),
              character: text,
              profile_path: z.string().nullish(),
              order: z.number().nullish(),
            }),
          )
          .nullish(),
        crew: z.array(z.object({ name: z.string().nullish(), job: z.string().nullish() })).nullish(),
      })
      .nullish(),
  })
  .transform((m): TmdbMovieDetails => {
    const cast = [...(m.credits?.cast ?? [])]
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
      .slice(0, MAX_CAST)
      .map((c) => ({ id: c.id, name: c.name, character: c.character, episodes: null, photo: imageFile(c.profile_path) }));
    const directors = (m.credits?.crew ?? []).filter((c) => c.job === "Director" && c.name).map((c) => c.name as string);
    return {
      id: m.id,
      title: m.title,
      releaseDate: m.release_date,
      runtime: m.runtime,
      genres: m.genres,
      overview: m.overview,
      tagline: m.tagline,
      posterFile: imageFile(m.poster_path),
      backdropFile: imageFile(m.backdrop_path),
      imdbId: m.imdb_id,
      directors: [...new Set(directors)],
      cast,
    };
  });

export const ShowDetailsSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    first_air_date: optionalText,
    number_of_seasons: positiveOrNull,
    number_of_episodes: positiveOrNull,
    episode_run_time: z.array(z.number()).nullish(),
    last_episode_to_air: z.object({ runtime: z.number().positive().nullish() }).nullish(),
    genres: genreList,
    overview: z.string().nullish().transform((v) => v ?? ""),
    tagline: text,
    poster_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    status: text,
    networks: names,
    created_by: names,
    aggregate_credits: z
      .object({
        cast: z
          .array(
            z.object({
              id: z.number().int(),
              name: z.string(),
              profile_path: z.string().nullish(),
              order: z.number().nullish(),
              total_episode_count: z.number().nullish(),
              roles: z.array(z.object({ character: z.string().nullish(), episode_count: z.number().nullish() })).nullish(),
            }),
          )
          .nullish(),
      })
      .nullish(),
  })
  .transform((s): TmdbShowDetails => {
    const cast = [...(s.aggregate_credits?.cast ?? [])]
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
      .slice(0, MAX_CAST)
      .map((c) => {
        // The role played in the most episodes.
        const role = [...(c.roles ?? [])].sort((a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0))[0];
        return {
          id: c.id,
          name: c.name,
          character: role?.character ? role.character : null,
          episodes: c.total_episode_count && c.total_episode_count > 0 ? c.total_episode_count : null,
          photo: imageFile(c.profile_path),
        };
      });
    const own = s.episode_run_time?.find((minutes) => minutes > 0) ?? null;
    return {
      id: s.id,
      name: s.name,
      firstAirDate: s.first_air_date,
      seasons: s.number_of_seasons,
      episodes: s.number_of_episodes,
      runtime: own ?? s.last_episode_to_air?.runtime ?? null,
      genres: s.genres,
      overview: s.overview,
      tagline: s.tagline,
      posterFile: imageFile(s.poster_path),
      backdropFile: imageFile(s.backdrop_path),
      status: s.status,
      networks: s.networks,
      createdBy: s.created_by,
      cast,
    };
  });
