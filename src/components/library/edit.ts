// Pure edit-dialog text for the library tables. Must not import from src/server at runtime.
import { countNoun, type Noun } from "./nouns";

/** What the dialog's Monitored select says. "keep" leaves each item's flag alone. */
export type MonitorChoice = "keep" | "monitored" | "unmonitored";

/** Dialog title: the item's own title for a single edit, otherwise "Edit N movies" / "Edit N series". */
export function editTitle(count: number, noun: Noun, title?: string): string {
  if (title !== undefined) return title;
  return `Edit ${countNoun(count, noun)}`;
}

/** The brief status line after a successful edit. */
export function updatedMessage(count: number, noun: Noun): string {
  return `Updated ${countNoun(count, noun)}`;
}
