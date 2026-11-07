// The synthetic library for the demo stack. Every title, name, studio, network, guid and id here is invented.
//
// Pure functions only: no I/O, and the only clock is the `now` argument. The same seed and `now` always give the
// same catalogue, so the calendar and queue stay current when the demo is started again.
import type { components as RadarrComponents } from "../../src/server/arr/generated/radarr";
import type { components as SonarrComponents } from "../../src/server/arr/generated/sonarr";

type RadarrSchemas = RadarrComponents["schemas"];
type SonarrSchemas = SonarrComponents["schemas"];

export type MovieResource = RadarrSchemas["MovieResource"];
export type CreditResource = RadarrSchemas["CreditResource"];
export type RadarrQualityProfile = RadarrSchemas["QualityProfileResource"];
export type RadarrRootFolder = RadarrSchemas["RootFolderResource"];
export type RadarrQueueItem = RadarrSchemas["QueueResource"];
export type RadarrHistoryRecord = RadarrSchemas["HistoryResource"];
export type ReleaseResource = RadarrSchemas["ReleaseResource"];

export type SeriesResource = SonarrSchemas["SeriesResource"];
export type EpisodeResource = SonarrSchemas["EpisodeResource"];
export type SonarrQualityProfile = SonarrSchemas["QualityProfileResource"];
export type SonarrRootFolder = SonarrSchemas["RootFolderResource"];
export type SonarrQueueItem = SonarrSchemas["QueueResource"];
export type SonarrHistoryRecord = SonarrSchemas["HistoryResource"];
export type SonarrRelease = SonarrSchemas["ReleaseResource"];
export type SeasonResource = SonarrSchemas["SeasonResource"];

export type PlexMovieEntry = {
  ratingKey: string;
  title: string;
  guids: string[];
  viewCount: number;
  viewOffset: number;
};

export type PlexShowEntry = {
  ratingKey: string;
  title: string;
  guids: string[];
  leafCount: number;
  viewedLeafCount: number;
};

export type PlexEpisodeEntry = {
  ratingKey: string;
  title: string;
  parentIndex: number;
  index: number;
  guids: string[];
  viewCount: number;
  viewOffset: number;
};

export type Catalogue = {
  now: number;
  radarr: {
    profiles: RadarrQualityProfile[];
    rootFolders: RadarrRootFolder[];
    movies: MovieResource[];
    /** Search hits that are not in the library yet. Adding one moves it into `movies`. */
    lookupMovies: MovieResource[];
    /** Cast and crew by TMDB id, so lookups and library movies share one list. */
    creditsByTmdbId: Record<number, CreditResource[]>;
    queue: RadarrQueueItem[];
    history: RadarrHistoryRecord[];
  };
  sonarr: {
    profiles: SonarrQualityProfile[];
    rootFolders: SonarrRootFolder[];
    series: SeriesResource[];
    episodes: EpisodeResource[];
    /** Search hits that are not in the library yet, with their episodes keyed by TVDB id. */
    lookupSeries: SeriesResource[];
    lookupEpisodesByTvdbId: Record<number, EpisodeResource[]>;
    queue: SonarrQueueItem[];
    history: SonarrHistoryRecord[];
  };
  plex: {
    sections: { key: string; type: "movie" | "show"; title: string }[];
    movies: PlexMovieEntry[];
    shows: PlexShowEntry[];
    /** Episodes of each show, keyed by the show's ratingKey. */
    episodesByShowKey: Record<string, PlexEpisodeEntry[]>;
  };
  /** Which library items the demo seed puts into Movie Focus and TV Focus, by Arr id. */
  focus: { movieIds: number[]; seriesIds: number[] };
};

const DAY = 86_400_000;
export const CATALOGUE_SEED = 20261107;

/** A small seeded PRNG (mulberry32). Same seed, same sequence, on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const chance = (rng: Rng, p: number): boolean => rng() < p;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** "YYYY-MM-DD" in UTC. Sonarr's airDate is the local date, and the demo uses UTC for both. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO time in the form Radarr and Sonarr send, e.g. "2026-11-02T14:05:00Z". */
export function isoTime(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

// Invented titles, picked by hand so every one reads like a real film or series and none is a known real title
// (CLAUDE.md rule 5: no real library contents). Names are invented, and the studio and network names are fictional.
const TITLES = [
  "Lanterns Over Kessgate", "The Cartographer's Daughter", "Saltwater Ledger", "Nine Bells for Orla",
  "The Quiet Engine", "Paper Kites in Thornby", "Under the Amber Viaduct", "Halfway to Marrowfield",
  "The Last Train to Vesper", "Copperline", "A Season of Small Fires", "The Glassblower's Debt",
  "Moonrise at Fennick Bay", "Static on Channel Nine", "The Orchard Keepers", "Thirteen Rooms",
  "Driftwood Parliament", "The Weight of Lanterns", "Northbound Ferry", "Ink and Ashgrove",
  "The Clockmaker of Ilse Street", "Pale Harbour Lights", "Sundays at the Velloran", "The Ninth Signal",
  "Gravel Road Requiem", "A Map Without Edges", "The Tidewater Accord", "Echoes in Quennell Hall", "Hollowmere",
  "The Lighthouse Accountant", "Brightwater Junction", "The Sparrow Census", "Kettle Hill",
  "The Long Afternoon of Romy Fenn", "Carousel at Low Tide", "The Silent Foundry", "Marigold Station",
  "An Orbit of Three", "The Gilded Static", "Weathervane", "The Almanac Club", "Fog Over Dunmarrow",
  "The Ember Transcript", "Two Coins for Corin", "Seawall", "The Ferryman's Almanac", "Velvet Underpass",
  "The Hourglass Riddle", "Starling Avenue", "Copper Moths", "The Brennock Inheritance", "Rain on the Causeway",
  "The Paper Lantern Society", "Quarry Lake", "Night Shift at the Planetarium", "The Tapestry Thief", "Westerly",
  "Halcyon Parade", "The Ostrand Files", "Lullaby for a Lighthouse", "Ironbark Valley", "The Comet Wardens",
  "Salt and Saffron", "The Kattering Line", "Thornaby Circle", "Signals from Marrowfield", "The Night Cartographers",
  "Harbourline", "The Verdant Hour", "Mireau & Daughters", "The Fenwarden Mysteries", "Low Tide Diaries",
  "Lantern District", "The Sallowe Archive", "Corvane Heights", "The Quiet Constable", "Northlight Rescue",
  "The Haskerby Hotel", "Willowmere Academy", "The Varro Brothers", "Second Harbour", "Glasshouse Kitchen",
  "The Ashgrove Assizes", "Tideline", "Copper Coast Patrol", "The Wren Report", "Dagny Takes the Stand",
  "Midwinter Market", "The Bellfounders", "Pell & Ostrand", "Sixty Steps to the Sea", "The Lantern Room",
  "Riverglass", "The Ninefold Path", "Ember Lane", "The Kestrel Inquiry",
];

const FIRST_NAMES = ["Ilse", "Tobiah", "Mara", "Corin", "Yusra", "Dagny", "Pell", "Wren", "Oskar", "Ines", "Hal", "Nadia", "Felix", "Romy", "Ansel", "Bettina", "Caspar", "Dorit", "Elowen", "Gideon"];
const LAST_NAMES = ["Brennock", "Velloran", "Ostrand", "Dunmarrow", "Kattering", "Quennell", "Thornaby", "Fenwarden", "Mireau", "Haskerby", "Varro", "Sallowe", "Corvane", "Ashgrove"];
const CHARACTER_TITLES = ["Inspector", "Captain", "Doctor", "Warden", "Constable", "Archivist", "Mother", "Professor"];
const CHARACTER_NAMES = ["Hale", "Sable", "Ferris", "Orrin", "Vell", "Marrow", "Quill", "Tamsin", "Lark", "Brisk", "Ondine", "Pike"];
// Synopses are built as "When <subject> finds <event>, they <resolution>", plus an optional second sentence.
const SUBJECTS = [
  "a retired mapmaker", "two estranged sisters", "a night-shift radio host", "a small-town constable", "a ferry captain",
  "a young archivist", "an out-of-work magician", "a lighthouse keeper", "a pair of rival bakers", "a museum night guard",
];
const EVENTS = [
  "a letter that was never posted", "a door that wasn't there yesterday", "a ledger full of strangers' names",
  "a signal from an empty island", "a map of a street that doesn't exist", "a key to the old observatory",
  "a photograph of their own wedding, years early", "a stowaway in the lifeboat",
];
const RESOLUTIONS = [
  "follow it to the edge of the county.", "have one winter to put things right.", "must decide who to trust.",
  "start asking questions nobody wants answered.", "go looking for the person who left it.",
  "discover the town has been keeping score.",
];
const SECOND_SENTENCES = ["It is a quiet story with a loud ending.", "Each chapter opens a new door.", "The town remembers more than it admits."];
const EPISODE_WORDS = [
  "Pilot", "The Long Way Round", "Low Water", "Open Season", "Second Sight", "The Night Ferry", "Paper Trail",
  "Old Debts", "High Tide", "The Visitor", "Loose Ends", "Lights Out", "Crossing Over", "The Inventory",
  "Homecoming", "Fault Lines", "The Witness", "Small Hours", "First Frost", "Last Orders",
];
const STUDIOS = ["Lantern Pictures", "Harbourline Films", "Northlight Studios", "Kestrel Works", "Ironbark Pictures"];
const NETWORKS = ["Northlight TV", "Lakeside Channel", "Kestrel Network", "Harbourline TV", "Ironbark Streaming"];
const GENRES = ["Drama", "Thriller", "Science Fiction", "Mystery", "Comedy", "Romance", "Horror", "Crime", "Adventure", "Fantasy"];
const MOVIE_CERTIFICATIONS = ["PG", "PG-13", "R", "NR"];
const SERIES_CERTIFICATIONS = ["TV-PG", "TV-14", "TV-MA"];

/** The next unused title from TITLES, in an order shuffled by the seeded generator. */
function makeTitle(rng: Rng, used: Set<string>): string {
  const left = TITLES.filter((title) => !used.has(title));
  if (left.length === 0) throw new Error("demo catalogue: ran out of titles; add more to TITLES");
  const title = left[Math.floor(rng() * left.length)];
  used.add(title);
  return title;
}

function makePersonName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

function makeCharacterName(rng: Rng): string {
  return chance(rng, 0.5) ? `${pick(rng, CHARACTER_TITLES)} ${pick(rng, CHARACTER_NAMES)}` : pick(rng, CHARACTER_NAMES);
}

function makeSynopsis(rng: Rng): string {
  const first = `When ${pick(rng, SUBJECTS)} finds ${pick(rng, EVENTS)}, they ${pick(rng, RESOLUTIONS)}`;
  return chance(rng, 0.5) ? `${first} ${pick(rng, SECOND_SENTENCES)}` : first;
}

function imdbIdFor(index: number): string {
  return `tt9${String(index + 1).padStart(6, "0")}`;
}

/** The ids the fakes and the Plex side use for each item, all in made-up ranges. */
const MOVIE_TMDB_BASE = 900_000;
const SERIES_TVDB_BASE = 300_000;
const PLEX_MOVIE_KEY_BASE = 1000;
const PLEX_SHOW_KEY_BASE = 2000;

type Quality = { id: number; name: string };
const RADARR_QUALITIES: Record<"1080" | "web1080" | "2160" | "720", Quality> = {
  "1080": { id: 7, name: "Bluray-1080p" },
  web1080: { id: 3, name: "WEBDL-1080p" },
  "2160": { id: 19, name: "Bluray-2160p" },
  "720": { id: 5, name: "WEBDL-720p" },
};

function qualityModel(quality: Quality) {
  return { quality: { id: quality.id, name: quality.name, source: "demo", resolution: 0 }, revision: { version: 1, real: 0, isRepack: false } };
}

function demoProfiles() {
  return [
    { id: 1, name: "HD-1080p", upgradeAllowed: true, cutoff: 7, items: [] },
    { id: 2, name: "Ultra-HD", upgradeAllowed: true, cutoff: 19, items: [] },
  ];
}

const MOVIE_COUNT = 60;
const MOVIE_LOOKUP_COUNT = 8;
const SERIES_COUNT = 20;
const SERIES_LOOKUP_COUNT = 3;

/** Movie with its library state. `kind` is decided by index so the mix is the same every time. */
function movieKind(index: number): "unmonitored" | "missing" | "unreleased" | "downloaded" {
  if (index % 10 === 9) return "unmonitored";
  if (index % 7 === 3) return "missing";
  if (index % 5 === 0 && index % 3 === 0) return "unreleased";
  return "downloaded";
}

function buildMovie(rng: Rng, now: number, index: number, id: number, title: string, tmdbId: number, library: boolean): MovieResource {
  const year = int(rng, 1985, 2026);
  const kind = library ? movieKind(index) : "missing";
  const profileId = index % 4 === 0 ? 2 : 1;
  const monitored = kind !== "unmonitored";
  // Theatrical date in the release year. Unreleased movies (2026, not out yet) get a date in the future.
  const theatrical = Date.UTC(year, int(rng, 0, 11), int(rng, 1, 27));
  // Released movies never get a date in the future. Only the unreleased ones do.
  const cinema = kind === "unreleased" ? now + int(rng, 30, 200) * DAY : Math.min(theatrical, now - 30 * DAY);
  const digital = cinema + 90 * DAY;
  const physical = cinema + 150 * DAY;
  const isAvailable = kind !== "unreleased";
  const hasFile = kind === "downloaded";
  const quality = profileId === 2 ? RADARR_QUALITIES["2160"] : chance(rng, 0.5) ? RADARR_QUALITIES["1080"] : RADARR_QUALITIES.web1080;
  const size = profileId === 2 ? int(rng, 20, 40) * 1e9 : int(rng, 4, 12) * 1e9;
  const genres = [pick(rng, GENRES), pick(rng, GENRES)].filter((genre, i, all) => all.indexOf(genre) === i);
  const sortTitle = title.replace(/^The /, "").toLowerCase();
  const path = `/media/movies/${title} (${year})`;
  const movie: MovieResource = {
    id,
    title,
    originalTitle: title,
    sortTitle,
    sizeOnDisk: hasFile ? size : 0,
    status: kind === "unreleased" ? "announced" : "released",
    overview: makeSynopsis(rng),
    inCinemas: isoTime(cinema),
    physicalRelease: isoTime(physical),
    digitalRelease: isoTime(digital),
    images: [
      { coverType: "poster", url: `/MediaCover/${id}/poster.jpg` },
      { coverType: "fanart", url: `/MediaCover/${id}/fanart.jpg` },
    ],
    website: "",
    year,
    hasFile,
    movieFileId: hasFile ? id * 10 : 0,
    youTubeTrailerId: "",
    studio: pick(rng, STUDIOS),
    path,
    qualityProfileId: profileId,
    monitored,
    minimumAvailability: "released",
    isAvailable,
    folderName: `${title} (${year})`,
    runtime: int(rng, 84, 165),
    cleanTitle: sortTitle.replace(/[^a-z0-9]/g, ""),
    imdbId: imdbIdFor(index),
    tmdbId,
    titleSlug: `${sortTitle.replace(/[^a-z0-9]+/g, "-")}-${year}`,
    rootFolderPath: "/media/movies",
    folder: path,
    certification: pick(rng, MOVIE_CERTIFICATIONS),
    genres,
    keywords: [],
    tags: [],
    ratings: {
      imdb: { value: round1(5 + rng() * 4), votes: int(rng, 800, 90_000) },
      tmdb: { value: round1(5 + rng() * 4), votes: int(rng, 200, 9000) },
    },
    originalLanguage: { id: 1, name: "English" },
    added: isoTime(now - int(rng, 20, 400) * DAY),
  };
  if (hasFile) {
    movie.movieFile = {
      id: id * 10,
      movieId: id,
      relativePath: `${title} (${year}).mkv`,
      path: `${path}/${title} (${year}).mkv`,
      size,
      dateAdded: isoTime(now - int(rng, 5, 300) * DAY),
      quality: qualityModel(quality),
    } as MovieResource["movieFile"];
  }
  return movie;
}

function buildCredits(rng: Rng): CreditResource[] {
  const castCount = int(rng, 6, 10);
  const credits: CreditResource[] = [];
  for (let order = 0; order < castCount; order++) {
    credits.push({
      id: int(rng, 10_000, 99_999),
      personName: makePersonName(rng),
      character: makeCharacterName(rng),
      order,
      type: "cast",
      department: "Acting",
      images: [],
    } as CreditResource);
  }
  credits.push({ id: int(rng, 10_000, 99_999), personName: makePersonName(rng), character: null, type: "crew", department: "Directing", job: "Director", images: [] } as CreditResource);
  return credits;
}

/** Radarr-style release search results for one movie, deterministic per movie id. */
export function radarrReleases(movie: MovieResource): ReleaseResource[] {
  const rng = mulberry32(CATALOGUE_SEED + (movie.id ?? 0) * 7919);
  const names = ["1080p", "2160p", "720p", "WEB-DL-1080p"];
  const releases: ReleaseResource[] = [];
  const count = int(rng, 6, 9);
  for (let k = 0; k < count; k++) {
    const quality = pick(rng, [RADARR_QUALITIES["1080"], RADARR_QUALITIES.web1080, RADARR_QUALITIES["720"], RADARR_QUALITIES["2160"]]);
    const protocol = chance(rng, 0.6) ? "usenet" : "torrent";
    const approved = k < 4;
    const title = `${(movie.title ?? "Untitled").replace(/ /g, ".")}.${movie.year ?? 2000}.${pick(rng, names)}.DEMO${k}`;
    releases.push({
      guid: `demo-radarr-${movie.id}-${k}`,
      quality: qualityModel(quality),
      customFormats: [],
      customFormatScore: 0,
      size: int(rng, 1, 30) * 1e9,
      indexerId: 1 + (k % 2),
      indexer: k % 2 === 0 ? "Example Indexer A" : "Example Indexer B",
      releaseGroup: "DEMO",
      title,
      sceneSource: false,
      protocol,
      age: int(rng, 0, 900),
      ageHours: int(rng, 0, 900) * 24,
      ageMinutes: 0,
      seeders: protocol === "torrent" ? int(rng, 2, 400) : null,
      leechers: protocol === "torrent" ? int(rng, 0, 60) : null,
      languages: [{ id: 1, name: "English" }],
      approved,
      temporarilyRejected: false,
      rejected: !approved,
      rejections: approved ? [] : ["Not an upgrade for existing movie file"],
      downloadAllowed: true,
      publishDate: isoTime(Date.now() - int(rng, 1, 800) * DAY),
    } as ReleaseResource);
  }
  return releases;
}

/** Sonarr-style release search results for one episode or one season. `episodeNumbers` are the ones the search targets. */
export function sonarrReleases(series: SeriesResource, seasonNumber: number, episodeNumbers: number[], seasonPack: boolean): SonarrRelease[] {
  const rng = mulberry32(CATALOGUE_SEED + (series.id ?? 0) * 104729 + seasonNumber * 131 + (episodeNumbers[0] ?? 0));
  const releases: SonarrRelease[] = [];
  const count = int(rng, 4, 7);
  const titleBase = (series.title ?? "Untitled").replace(/ /g, ".");
  const code = `S${String(seasonNumber).padStart(2, "0")}`;
  for (let k = 0; k < count; k++) {
    const pack = seasonPack && k === 0;
    const quality = pick(rng, [RADARR_QUALITIES.web1080, RADARR_QUALITIES["1080"], RADARR_QUALITIES["720"]]);
    const protocol = chance(rng, 0.6) ? "usenet" : "torrent";
    const approved = k < 3;
    const numbers = pack ? episodeNumbers : [episodeNumbers[k % Math.max(1, episodeNumbers.length)] ?? 1];
    const episodeCode = pack ? "" : `E${String(numbers[0]).padStart(2, "0")}`;
    releases.push({
      guid: `demo-sonarr-${series.id}-${seasonNumber}-${k}-${pack ? "pack" : "single"}`,
      quality: qualityModel(quality),
      customFormats: [],
      customFormatScore: 0,
      size: pack ? int(rng, 8, 40) * 1e9 : int(rng, 1, 4) * 1e9,
      indexerId: 1 + (k % 2),
      indexer: k % 2 === 0 ? "Example Indexer A" : "Example Indexer B",
      releaseGroup: "DEMO",
      title: `${titleBase}.${code}${episodeCode}.${quality.name}.DEMO${k}`,
      sceneSource: false,
      protocol,
      age: int(rng, 0, 900),
      ageHours: int(rng, 0, 900) * 24,
      ageMinutes: 0,
      seeders: protocol === "torrent" ? int(rng, 2, 400) : null,
      leechers: protocol === "torrent" ? int(rng, 0, 60) : null,
      languages: [{ id: 1, name: "English" }],
      approved,
      temporarilyRejected: false,
      rejected: !approved,
      rejections: approved ? [] : ["Not an upgrade for existing episode file"],
      downloadAllowed: true,
      publishDate: isoTime(Date.now() - int(rng, 1, 800) * DAY),
      fullSeason: pack,
      seasonNumber,
      mappedSeasonNumber: seasonNumber,
      mappedEpisodeNumbers: numbers,
      mappedAbsoluteEpisodeNumbers: [],
      episodeRequested: !pack,
    } as SonarrRelease);
  }
  return releases;
}

/** One series and its episodes, before any library id is assigned. `ids` gives the episode ids to use. */
type SeriesBuild = { series: SeriesResource; episodes: EpisodeResource[] };

type SeriesProfile = "continuing" | "ended-full" | "ended-partial" | "ended-empty" | "upcoming";

function seriesProfile(index: number): SeriesProfile {
  if (index < 8) return "continuing";
  if (index < 17) return ["ended-full", "ended-partial", "ended-empty"][(index - 8) % 3] as SeriesProfile;
  return "upcoming";
}

function buildSeries(
  rng: Rng,
  now: number,
  index: number,
  id: number,
  title: string,
  tvdbId: number,
  nextEpisodeId: () => number,
  library: boolean,
): SeriesBuild {
  const profile = library ? seriesProfile(index) : "upcoming";
  const seasonCount = int(rng, 1, 6);
  const withSpecials = index % 5 === 2;
  const seasonSizes: { seasonNumber: number; count: number }[] = [];
  if (withSpecials) seasonSizes.push({ seasonNumber: 0, count: int(rng, 2, 3) });
  for (let s = 1; s <= seasonCount; s++) seasonSizes.push({ seasonNumber: s, count: int(rng, 6, 10) });
  const total = seasonSizes.reduce((sum, season) => sum + season.count, 0);

  // Air dates run backwards from the last episode (ended, continuing) or forwards from next week (upcoming).
  const lastAired = profile === "continuing" ? now + int(rng, 3, 19) * DAY : now - int(rng, 60, 900) * DAY;
  const schedule: number[] = [];
  for (let g = 0; g < total; g++) {
    const weeksFromEnd = total - 1 - g;
    schedule.push(profile === "upcoming" ? now + (7 + g * 7) * DAY : lastAired - weeksFromEnd * 7 * DAY);
  }
  const firstAired = schedule[0];
  const lastAiredDay = schedule[schedule.length - 1];

  const monitoredSeries = !(library && index === 12);
  const episodes: EpisodeResource[] = [];
  let g = 0;
  const seasonRows: SeasonResource[] = [];
  for (const season of seasonSizes) {
    const seasonMonitored = !(library && index === 5 && season.seasonNumber === 2);
    const seasonEpisodes: EpisodeResource[] = [];
    for (let e = 1; e <= season.count; e++) {
      const airMs = schedule[g];
      const aired = airMs <= now;
      const episodeId = nextEpisodeId();
      // Per-episode monitoring is mostly on. A few episodes are unticked, as a user might leave them.
      const episodeMonitored = monitoredSeries && seasonMonitored && !(chance(rng, 0.05));
      let hasFile = false;
      if (library && aired) {
        if (profile === "ended-full" || profile === "continuing") hasFile = profile === "ended-full" || !isLastAired(g, total);
        if (profile === "ended-partial") hasFile = chance(rng, 0.6);
      }
      const size = int(rng, 350, 2600) * 1e6;
      const quality = RADARR_QUALITIES.web1080;
      const episode: EpisodeResource = {
        id: episodeId,
        seriesId: id,
        tvdbId: tvdbId * 100 + g + 1,
        episodeFileId: hasFile ? episodeId * 10 : 0,
        seasonNumber: season.seasonNumber,
        episodeNumber: e,
        title: pick(rng, EPISODE_WORDS),
        airDate: isoDate(airMs),
        airDateUtc: `${isoDate(airMs)}T01:00:00Z`,
        runtime: int(rng, 22, 58),
        overview: "",
        hasFile,
        monitored: episodeMonitored,
        absoluteEpisodeNumber: g + 1,
        unverifiedSceneNumbering: false,
        finaleType: null,
      } as EpisodeResource;
      if (hasFile) {
        episode.episodeFile = {
          id: episodeId * 10,
          seriesId: id,
          seasonNumber: season.seasonNumber,
          relativePath: `Season ${season.seasonNumber}/${title} S${String(season.seasonNumber).padStart(2, "0")}E${String(e).padStart(2, "0")}.mkv`,
          path: `/media/tv/${title}/Season ${season.seasonNumber}/${title} S${String(season.seasonNumber).padStart(2, "0")}E${String(e).padStart(2, "0")}.mkv`,
          size,
          dateAdded: isoTime(airMs + 2 * DAY),
          quality: qualityModel(quality),
        } as EpisodeResource["episodeFile"];
      }
      seasonEpisodes.push(episode);
      episodes.push(episode);
      g += 1;
    }
    seasonRows.push({
      seasonNumber: season.seasonNumber,
      monitored: seasonMonitored,
      images: [],
      statistics: seasonStatistics(seasonEpisodes, now),
    } as SeasonResource);
  }

  const statistics = seriesStatistics(episodes, seasonRows.length, now);
  const status: SeriesResource["status"] = profile === "continuing" ? "continuing" : profile === "upcoming" ? "upcoming" : "ended";
  const nextAiring = episodes.find((episode) => episode.airDateUtc && Date.parse(episode.airDateUtc) > now);
  const series: SeriesResource = {
    id,
    title,
    sortTitle: title.replace(/^The /, "").toLowerCase(),
    status,
    overview: makeSynopsis(rng),
    network: pick(rng, NETWORKS),
    year: new Date(firstAired).getUTCFullYear(),
    path: `/media/tv/${title}`,
    rootFolderPath: "/media/tv",
    qualityProfileId: index % 4 === 1 ? 2 : 1,
    seasonFolder: true,
    monitored: monitoredSeries,
    monitorNewItems: "all",
    seriesType: index % 6 === 5 ? "anime" : "standard",
    added: isoTime(now - int(rng, 30, 900) * DAY),
    images: [
      { coverType: "poster", url: `/MediaCover/${id}/poster.jpg` },
      { coverType: "fanart", url: `/MediaCover/${id}/fanart.jpg` },
    ],
    tvdbId,
    imdbId: imdbIdFor(100 + index),
    tmdbId: tvdbId + 1,
    genres: [pick(rng, GENRES), pick(rng, GENRES)].filter((genre, i, all) => all.indexOf(genre) === i),
    tags: [],
    seasons: seasonRows,
    statistics,
    certification: pick(rng, SERIES_CERTIFICATIONS),
    runtime: int(rng, 22, 58),
    ratings: { votes: int(rng, 300, 40_000), value: round1(5 + rng() * 4) },
    firstAired: isoTime(firstAired).slice(0, 10) + "T00:00:00Z",
    lastAired: isoTime(lastAiredDay).slice(0, 10) + "T00:00:00Z",
    nextAiring: nextAiring ? `${nextAiring.airDate}T01:00:00Z` : null,
    originalLanguage: { id: 1, name: "English" },
    titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    cleanTitle: title.toLowerCase().replace(/[^a-z0-9]/g, ""),
  } as SeriesResource;
  return { series, episodes };
}

/** The final episode index of a show, used so the newest episode of a continuing show is the one left unwatched. */
function isLastAired(index: number, total: number): boolean {
  return index >= total - 2;
}

/** Season rows for a list of episodes. `seasonMonitored` says whether each season is monitored. Used when the fakes add a show. */
export function seasonRowsFor(episodes: EpisodeResource[], now: number, seasonMonitored: (seasonNumber: number) => boolean): SeasonResource[] {
  const numbers = [...new Set(episodes.map((episode) => episode.seasonNumber ?? 0))].sort((a, b) => a - b);
  return numbers.map((seasonNumber) => {
    const seasonEpisodes = episodes.filter((episode) => episode.seasonNumber === seasonNumber);
    return {
      seasonNumber,
      monitored: seasonMonitored(seasonNumber),
      images: [],
      statistics: seasonStatistics(seasonEpisodes, now),
    } as SeasonResource;
  });
}

/** Series statistics for a list of episodes. */
export function seriesStatisticsFor(episodes: EpisodeResource[], seasonCount: number, now: number) {
  return seriesStatistics(episodes, seasonCount, now);
}

function seasonStatistics(episodes: EpisodeResource[], now: number) {
  const fileEpisodes = episodes.filter((episode) => episode.hasFile === true);
  return {
    episodeFileCount: fileEpisodes.length,
    episodeCount: episodes.filter((episode) => Date.parse(episode.airDateUtc ?? "") <= now && episode.monitored === true).length,
    totalEpisodeCount: episodes.length,
    sizeOnDisk: fileEpisodes.reduce((sum, episode) => sum + (episode.episodeFile?.size ?? 0), 0),
    percentOfEpisodes: episodes.length === 0 ? 0 : Math.round((fileEpisodes.length / episodes.length) * 100),
    releaseGroups: fileEpisodes.length > 0 ? ["DEMO"] : [],
  };
}

function seriesStatistics(episodes: EpisodeResource[], seasonCount: number, now: number) {
  const stats = seasonStatistics(episodes, now);
  return { ...stats, seasonCount };
}

/** Shows that are in Plex list only episodes that have a file. A show with no file is not in Plex at all. */
function plexEpisodesFor(rng: Rng, episodes: EpisodeResource[]): PlexEpisodeEntry[] {
  const out: PlexEpisodeEntry[] = [];
  let key = 3000 + (episodes[0]?.seriesId ?? 0) * 100;
  for (const episode of episodes) {
    if (episode.hasFile !== true) continue;
    const roll = rng();
    const viewCount = roll < 0.55 ? 1 : 0;
    const viewOffset = viewCount === 0 && roll < 0.7 ? 900_000 : 0;
    out.push({
      ratingKey: String(key++),
      title: episode.title ?? "TBA",
      parentIndex: episode.seasonNumber ?? 0,
      index: episode.episodeNumber ?? 0,
      guids: [`tvdb://${episode.tvdbId}`],
      viewCount,
      viewOffset,
    });
  }
  return out;
}

/** Sonarr-style queue for one missing episode: one row per download, the same shape the queue page reads. */
function sonarrQueueItem(id: number, series: SeriesResource, episode: EpisodeResource, now: number, status: "downloading" | "completed", state: string, sizeLeft: number, size: number): SonarrQueueItem {
  return {
    id,
    seriesId: series.id,
    episodeId: episode.id,
    seasonNumber: episode.seasonNumber,
    series,
    episode,
    quality: qualityModel(RADARR_QUALITIES.web1080),
    title: `${(series.title ?? "").replace(/ /g, ".")}.S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}.1080p.WEB-DL.DEMO`,
    size,
    sizeleft: sizeLeft,
    estimatedCompletionTime: status === "downloading" ? isoTime(now + 40 * 60_000) : undefined,
    status,
    trackedDownloadStatus: state === "importBlocked" ? "warning" : "ok",
    trackedDownloadState: state,
    statusMessages:
      state === "importPending" ? [{ title: "Waiting to import", messages: ["Waiting for another episode of this download."] }] : [],
    downloadId: `DEMO${String(id).padStart(6, "0")}`,
    protocol: "usenet",
    downloadClient: "Fake Download Client",
    indexer: "Example Indexer A",
    outputPath: `/downloads/demo/${id}`,
  } as SonarrQueueItem;
}

function radarrQueueItem(id: number, movie: MovieResource, now: number, state: "downloading" | "paused" | "importBlocked", size: number, sizeLeft: number): RadarrQueueItem {
  const status = state === "importBlocked" ? "warning" : state;
  return {
    id,
    movieId: movie.id,
    movie,
    quality: qualityModel(RADARR_QUALITIES.web1080),
    title: `${(movie.title ?? "").replace(/ /g, ".")}.${movie.year ?? 2000}.1080p.WEB-DL.DEMO`,
    size,
    sizeleft: sizeLeft,
    estimatedCompletionTime: state === "downloading" ? isoTime(now + 25 * 60_000) : undefined,
    status,
    trackedDownloadStatus: state === "importBlocked" ? "warning" : "ok",
    trackedDownloadState: state === "importBlocked" ? "importBlocked" : "downloading",
    statusMessages:
      state === "importBlocked" ? [{ title: "Manual import needed", messages: ["Manual import required for this download."] }] : [],
    downloadId: `DEMO${String(id + 100).padStart(6, "0")}`,
    protocol: "torrent",
    downloadClient: "Fake Download Client",
    indexer: "Example Indexer B",
    outputPath: `/downloads/demo/movie-${id}`,
  } as RadarrQueueItem;
}

const RADARR_EVENT_PATTERN = ["grabbed", "downloadFolderImported", "grabbed", "downloadFolderImported", "downloadFailed", "movieFileDeleted"] as const;
const SONARR_EVENT_PATTERN = ["grabbed", "seriesFolderImported", "downloadFolderImported", "grabbed", "downloadFailed", "episodeFileDeleted"] as const;

function historyDate(rng: Rng, now: number): string {
  return isoTime(now - int(rng, 1, 29 * 24 * 60) * 60_000);
}

/**
 * Builds the whole demo library: about 60 movies, 20 series, a few lookup-only titles for the Add search, the
 * queue, 40 history records over the last 30 days, and the Plex state that matches the library.
 */
export function buildCatalogue(now: number): Catalogue {
  const rng = mulberry32(CATALOGUE_SEED);
  const usedTitles = new Set<string>();

  let nextEpisodeId = 10_001;
  const episodeIds = () => nextEpisodeId++;

  // Movies: library first, then lookup-only titles with ids that are not used by the library.
  const movies: MovieResource[] = [];
  const creditsByTmdbId: Record<number, CreditResource[]> = {};
  for (let i = 0; i < MOVIE_COUNT; i++) {
    const title = makeTitle(rng, usedTitles);
    const movie = buildMovie(rng, now, i, i + 1, title, MOVIE_TMDB_BASE + i, true);
    movies.push(movie);
    creditsByTmdbId[movie.tmdbId ?? 0] = buildCredits(rng);
  }
  const lookupMovies: MovieResource[] = [];
  for (let i = 0; i < MOVIE_LOOKUP_COUNT; i++) {
    const title = makeTitle(rng, usedTitles);
    const tmdbId = MOVIE_TMDB_BASE + MOVIE_COUNT + i;
    const movie = buildMovie(rng, now, MOVIE_COUNT + i, 0, title, tmdbId, false);
    movie.id = 0;
    movie.hasFile = false;
    movie.movieFile = undefined;
    lookupMovies.push(movie);
    creditsByTmdbId[tmdbId] = buildCredits(rng);
  }

  // Calendar movies: some released-but-not-downloaded movies get digital dates inside the calendar window.
  const calendarOffsets = [-6, -3, -1, 2, 5, 9, 14, 20];
  let calendarIndex = 0;
  for (const movie of movies) {
    if (calendarIndex >= calendarOffsets.length) break;
    if (movie.hasFile || movie.monitored !== true || movie.isAvailable !== true) continue;
    movie.digitalRelease = isoTime(now + calendarOffsets[calendarIndex] * DAY);
    calendarIndex += 1;
  }

  // Series: library first, then lookup-only shows with their own episodes.
  const series: SeriesResource[] = [];
  const episodes: EpisodeResource[] = [];
  for (let i = 0; i < SERIES_COUNT; i++) {
    const title = makeTitle(rng, usedTitles);
    const built = buildSeries(rng, now, i, i + 1, title, SERIES_TVDB_BASE + i, episodeIds, true);
    series.push(built.series);
    episodes.push(...built.episodes);
  }
  const lookupSeries: SeriesResource[] = [];
  const lookupEpisodesByTvdbId: Record<number, EpisodeResource[]> = {};
  for (let i = 0; i < SERIES_LOOKUP_COUNT; i++) {
    const title = makeTitle(rng, usedTitles);
    const tvdbId = SERIES_TVDB_BASE + SERIES_COUNT + i;
    const built = buildSeries(rng, now, SERIES_COUNT + i, 0, title, tvdbId, episodeIds, false);
    built.series.id = 0;
    built.series.statistics = undefined;
    built.series.seasons = [];
    lookupSeries.push(built.series);
    lookupEpisodesByTvdbId[tvdbId] = built.episodes.map((episode) => ({ ...episode, seriesId: 0, hasFile: false, episodeFile: undefined }));
  }

  // Queue: three Radarr rows (downloading, paused, import blocked) and two Sonarr rows (downloading, import pending).
  const missingMovies = movies.filter((movie) => movie.monitored === true && movie.hasFile !== true && movie.isAvailable === true);
  const missingEpisodes = episodes.filter((episode) => episode.hasFile !== true && episode.monitored === true && Date.parse(episode.airDateUtc ?? "") <= now);
  const seriesById = new Map(series.map((show) => [show.id, show]));
  const episodeQueueCandidates = missingEpisodes.slice(-2);
  const radarrQueue: RadarrQueueItem[] = [
    radarrQueueItem(1, missingMovies[0], now, "downloading", 9e9, 4e9),
    radarrQueueItem(2, missingMovies[1], now, "paused", 7e9, 6e9),
    radarrQueueItem(3, missingMovies[2], now, "importBlocked", 8e9, 0),
  ];
  const sonarrQueue: SonarrQueueItem[] = [
    sonarrQueueItem(1, seriesById.get(episodeQueueCandidates[0]?.seriesId ?? 0) ?? series[0], episodeQueueCandidates[0], now, "downloading", "downloading", 1e9, 2.4e9),
    sonarrQueueItem(2, seriesById.get(episodeQueueCandidates[1]?.seriesId ?? 0) ?? series[1], episodeQueueCandidates[1], now, "completed", "importPending", 0, 1.8e9),
  ];

  // History: 20 Radarr records from downloaded movies, 20 Sonarr records from downloaded episodes, spread over 30 days.
  const downloadedMovies = movies.filter((movie) => movie.hasFile === true);
  const downloadedEpisodes = episodes.filter((episode) => episode.hasFile === true);
  const radarrHistory: RadarrHistoryRecord[] = [];
  for (let k = 0; k < 20; k++) {
    const movie = downloadedMovies[k % downloadedMovies.length];
    const eventType = RADARR_EVENT_PATTERN[k % RADARR_EVENT_PATTERN.length];
    radarrHistory.push({
      id: k + 1,
      movieId: movie.id,
      sourceTitle: `${(movie.title ?? "").replace(/ /g, ".")}.${movie.year ?? 2000}.1080p.BluRay.x264-DEMO`,
      quality: qualityModel(RADARR_QUALITIES["1080"]),
      customFormats: [],
      customFormatScore: 0,
      qualityCutoffNotMet: false,
      date: historyDate(rng, now),
      downloadId: `DEMO${String(k + 500).padStart(6, "0")}`,
      eventType,
      data: historyData(eventType, "Example Indexer A", k),
      movie,
    } as RadarrHistoryRecord);
  }
  const sonarrHistory: SonarrHistoryRecord[] = [];
  for (let k = 0; k < 20; k++) {
    const episode = downloadedEpisodes[k % downloadedEpisodes.length];
    const show = seriesById.get(episode.seriesId ?? 0) ?? series[0];
    const eventType = SONARR_EVENT_PATTERN[k % SONARR_EVENT_PATTERN.length];
    sonarrHistory.push({
      id: k + 1,
      seriesId: show.id,
      episodeId: episode.id,
      sourceTitle: `${(show.title ?? "").replace(/ /g, ".")}.S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}.720p.WEB.DEMO`,
      quality: qualityModel(RADARR_QUALITIES["720"]),
      languages: [{ id: 1, name: "English" }],
      customFormats: [],
      customFormatScore: 0,
      qualityCutoffNotMet: false,
      date: historyDate(rng, now),
      downloadId: `DEMO${String(k + 700).padStart(6, "0")}`,
      eventType,
      data: historyData(eventType, "Example Indexer B", k),
      episode,
      series: show,
    } as SonarrHistoryRecord);
  }

  // Plex: movies with a file are in the Plex library, except a few that Plex has not scanned yet.
  const plexMovies: PlexMovieEntry[] = [];
  for (const movie of movies) {
    if (movie.hasFile !== true || movie.id === undefined || movie.id % 13 === 5) continue;
    const roll = rng();
    plexMovies.push({
      ratingKey: String(PLEX_MOVIE_KEY_BASE + movie.id),
      title: movie.title ?? "",
      guids: [`tmdb://${movie.tmdbId}`, `imdb://${movie.imdbId}`],
      viewCount: roll < 0.35 ? 1 : 0,
      viewOffset: roll >= 0.35 && roll < 0.45 ? 1_200_000 : 0,
    });
  }
  const plexShows: PlexShowEntry[] = [];
  const episodesByShowKey: Record<string, PlexEpisodeEntry[]> = {};
  for (const show of series) {
    const showEpisodes = episodes.filter((episode) => episode.seriesId === show.id);
    const entries = plexEpisodesFor(rng, showEpisodes);
    if (entries.length === 0) continue;
    const ratingKey = String(PLEX_SHOW_KEY_BASE + (show.id ?? 0));
    episodesByShowKey[ratingKey] = entries;
    plexShows.push({
      ratingKey,
      title: show.title ?? "",
      guids: [`tvdb://${show.tvdbId}`],
      leafCount: entries.length,
      viewedLeafCount: entries.filter((entry) => entry.viewCount > 0).length,
    });
  }

  const focusMovieIds = movies.filter((movie) => movie.hasFile === true).slice(0, 4).map((movie) => movie.id ?? 0);
  const focusSeriesIds = series.filter((show) => show.status === "continuing").slice(0, 3).map((show) => show.id ?? 0);

  return {
    now,
    radarr: {
      profiles: demoProfiles() as RadarrQualityProfile[],
      rootFolders: [{ id: 1, path: "/media/movies", accessible: true, freeSpace: 480e9, unmappedFolders: [] } as RadarrRootFolder],
      movies,
      lookupMovies,
      creditsByTmdbId,
      queue: radarrQueue,
      history: radarrHistory,
    },
    sonarr: {
      profiles: demoProfiles() as SonarrQualityProfile[],
      rootFolders: [{ id: 1, path: "/media/tv", accessible: true, freeSpace: 960e9, unmappedFolders: [] } as SonarrRootFolder],
      series,
      episodes,
      lookupSeries,
      lookupEpisodesByTvdbId,
      queue: sonarrQueue,
      history: sonarrHistory,
    },
    plex: {
      sections: [
        { key: "1", type: "movie", title: "Movies" },
        { key: "2", type: "show", title: "TV Shows" },
      ],
      movies: plexMovies,
      shows: plexShows,
      episodesByShowKey,
    },
    focus: { movieIds: focusMovieIds, seriesIds: focusSeriesIds },
  };
}

/** The `data` map of a history record. Only the keys the app reads are set. */
function historyData(eventType: string, indexer: string, k: number): Record<string, string> {
  const data: Record<string, string> = { indexer, downloadClientName: "Fake Download Client", releaseGroup: "DEMO", size: String((k % 9) * 1e9 + 1e9) };
  if (eventType === "downloadFailed") data.message = "Download failed: unpacking error";
  return data;
}

/** The movies, shows and episodes a Radarr or Sonarr lookup or add can match, with their titles. Used by the fakes. */
export function searchTitles<T extends { title?: string | null; year?: number | null }>(items: T[], term: string): T[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return [];
  return items.filter((item) => (item.title ?? "").toLowerCase().includes(needle));
}
