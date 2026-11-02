import "server-only";

/** True when an item's images include a poster. Used by the Calendar and History merges. */
export function hasPoster(images: { coverType?: string }[] | null | undefined): boolean {
  return images?.some((image) => image.coverType === "poster") ?? false;
}
