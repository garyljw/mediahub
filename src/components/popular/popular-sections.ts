// The Popular page's sections, by id. Plain data: the page and the place memory both read it.
export const POPULAR_SECTION_IDS = ["trending-movies", "trending-tv", "service", "upcoming-movies", "upcoming-tv", "this-week"] as const;
export type PopularSectionId = (typeof POPULAR_SECTION_IDS)[number];
