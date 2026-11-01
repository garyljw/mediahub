// Singular and plural words for the two library tables. Pure, so it can be tested without a DOM.

/** A noun with its singular and plural forms. Series is the same word in both. */
export type Noun = { one: string; many: string };

export const MOVIE: Noun = { one: "movie", many: "movies" };
export const SERIES: Noun = { one: "series", many: "series" };

/** "1 movie", "3 movies". */
export function countNoun(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}
