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

// TMDB sends 0 for a figure or id it doesn't know yet (seen live on an unreleased film's runtime). Anything that isn't a
// whole number above 0 reads as null, and never fails the whole reply.
const positiveOrNull = z.number().nullish().transform((v) => (v != null && Number.isInteger(v) && v > 0 ? v : null));

/** tvdb_id may be null, missing or 0: the caller treats all three as "can't add". */
export const ExternalIdsSchema = z
  .object({ tvdb_id: positiveOrNull })
  .transform(({ tvdb_id }) => ({ tvdbId: tvdb_id }));

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
      // An id that isn't positive can't open a person page, so the member is left out.
      .filter((c) => c.id > 0)
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
    last_episode_to_air: z.object({ runtime: positiveOrNull }).nullish(),
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
      .filter((c) => c.id > 0)
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

// An episode's credits: the series regulars in that episode (cast), then its guests. Crew is ignored.

const MAX_EPISODE_CAST = 30;

const EpisodeCreditItem = z.object({
  id: z.number().int(),
  name: z.string(),
  character: text,
  profile_path: z.string().nullish(),
  order: z.number().nullish(),
});

export const EpisodeCreditsSchema = z
  .object({
    cast: z.array(EpisodeCreditItem).nullish(),
    guest_stars: z.array(EpisodeCreditItem).nullish(),
  })
  .transform((credits): TmdbCastMember[] => {
    const byOrder = (a: { order?: number | null }, b: { order?: number | null }) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    const seen = new Set<number>();
    const members: TmdbCastMember[] = [];
    for (const list of [credits.cast, credits.guest_stars]) {
      for (const c of [...(list ?? [])].sort(byOrder)) {
        // An id that isn't positive can't open a person page. A person in both lists shows once, as a regular.
        if (c.id <= 0 || seen.has(c.id)) continue;
        seen.add(c.id);
        members.push({ id: c.id, name: c.name, character: c.character, episodes: null, photo: imageFile(c.profile_path) });
      }
    }
    return members.slice(0, MAX_EPISODE_CAST);
  });

// Person pages. A person's details and their acting credits (cast only: crew is ignored).

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = z
  .string()
  .nullish()
  .transform((v) => (v && DATE_TEXT.test(v) ? v : null));

export type TmdbPerson = {
  id: number;
  name: string;
  /** May hold paragraph breaks ("\n\n"). "" when TMDB has none. */
  biography: string;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownFor: string | null;
  imdbId: string | null;
  photoFile: string | null;
};

export const PersonDetailsSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    biography: z.string().nullish().transform((v) => v ?? ""),
    birthday: dateOrNull,
    deathday: dateOrNull,
    place_of_birth: text,
    known_for_department: text,
    imdb_id: z
      .string()
      .nullish()
      .transform((v) => (v && /^nm\d+$/.test(v) ? v : null)),
    profile_path: z.string().nullish(),
  })
  .transform(
    (p): TmdbPerson => ({
      id: p.id,
      name: p.name,
      biography: p.biography.trim(),
      birthday: p.birthday,
      deathday: p.deathday,
      placeOfBirth: p.place_of_birth,
      knownFor: p.known_for_department,
      imdbId: p.imdb_id,
      photoFile: imageFile(p.profile_path),
    }),
  );

export type TmdbPersonCredit = {
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  date: string | null;
  character: string | null;
  episodes: number | null;
  posterFile: string | null;
  backdropFile: string | null;
  genreIds: number[];
  adult: boolean;
};

const PersonCreditItem = z.object({
  media_type: z.enum(["movie", "tv"]),
  id: z.number().int().positive(),
  adult: z.boolean().nullish(),
  character: z.string().nullish(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  release_date: z.string().nullish(),
  first_air_date: z.string().nullish(),
  // TMDB's date for this person's first appearance; the show's own first air date is the fallback.
  first_credit_air_date: z.string().nullish(),
  episode_count: z.number().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  genre_ids: genreIds,
});

export const PersonCreditsSchema = z
  .object({ cast: z.array(z.unknown()).nullish() })
  .transform(({ cast }): TmdbPersonCredit[] => {
    const credits: TmdbPersonCredit[] = [];
    // One odd item (an unknown media type, no title) is dropped; it must not fail the whole reply.
    for (const raw of cast ?? []) {
      const parsed = PersonCreditItem.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      const title = ((item.media_type === "movie" ? item.title : item.name) ?? "").trim();
      if (title === "") continue;
      const valid = (v: string | null | undefined) => (v && DATE_TEXT.test(v) ? v : null);
      const date = item.media_type === "movie" ? valid(item.release_date) : (valid(item.first_credit_air_date) ?? valid(item.first_air_date));
      const character = item.character?.trim() ?? "";
      credits.push({
        kind: item.media_type,
        tmdbId: item.id,
        title,
        date,
        character: character === "" ? null : character,
        episodes: item.media_type === "tv" && item.episode_count && item.episode_count > 0 ? item.episode_count : null,
        posterFile: imageFile(item.poster_path),
        backdropFile: imageFile(item.backdrop_path),
        genreIds: item.genre_ids,
        adult: item.adult === true,
      });
    }
    return credits;
  });
