// The categories the Popular page leaves out unless an admin ticks them in Settings -> Popular. Plain data, shared by the
// settings form and the server (which holds the TMDB ids).
export const POPULAR_INCLUDE_KEYS = ["documentary", "news", "reality", "soap", "talk"] as const;

export type PopularInclude = (typeof POPULAR_INCLUDE_KEYS)[number];

export const POPULAR_INCLUDE_LABELS: Record<PopularInclude, string> = {
  documentary: "Documentaries",
  news: "News",
  reality: "Reality, quiz and game shows",
  soap: "Soaps",
  talk: "Talk shows",
};
