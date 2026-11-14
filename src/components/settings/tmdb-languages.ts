// The original languages the Popular page can filter TV by. Plain data, shared by the settings form and its action.
export const TMDB_LANGUAGES = [
  { code: "any", name: "Any" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
] as const;

export type TmdbLanguage = (typeof TMDB_LANGUAGES)[number]["code"];

/** For z.enum. */
export const TMDB_LANGUAGE_CODES = TMDB_LANGUAGES.map((l) => l.code) as [TmdbLanguage, ...TmdbLanguage[]];

export const DEFAULT_TMDB_LANGUAGE: TmdbLanguage = "en";
