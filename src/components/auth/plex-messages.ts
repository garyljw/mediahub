// Fixed text for the ?plex= values the Plex sign-in routes redirect back with. Anything else shows nothing.
const PLEX_MESSAGES = new Map<string, string>([
  ["expired", "That Plex sign-in expired or was started in another browser. Start again."],
  ["not-approved", "Plex did not approve the sign-in. Start again."],
  ["denied", "That Plex account can't sign in to this MediaHub."],
  ["no-servers", "That Plex account doesn't own a Plex server. Sign in with the account that owns yours."],
  ["error", "Could not reach Plex. Try again in a moment."],
]);

export function plexErrorMessage(value: string | string[] | undefined): string | null {
  const key = Array.isArray(value) ? value[0] : value;
  return key === undefined ? null : (PLEX_MESSAGES.get(key) ?? null);
}
