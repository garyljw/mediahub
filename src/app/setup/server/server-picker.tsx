"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ServerOption = { clientIdentifier: string; name: string };

const SETUP_MESSAGES = new Map<string, string>([
  ["expired", "This Plex sign-in expired. Start again from the setup page."],
  ["already-set-up", "MediaHub is already set up. Sign in instead."],
]);
const GENERIC_ERROR = "Could not finish setup. Start again from the setup page.";

async function errorCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "";
}

export function ServerPicker({ servers }: { servers: ServerOption[] }) {
  const router = useRouter();
  // With only one owned server there is nothing to choose, so it starts selected.
  const [selected, setSelected] = useState(servers.length === 1 ? servers[0].clientIdentifier : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/plex/setup/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selected }),
      });
      if (response.ok) {
        // Stays pending: the next page replaces this one. The session cookie came with the reply.
        router.replace("/");
        router.refresh();
        return;
      }
      setError(SETUP_MESSAGES.get(await errorCode(response)) ?? GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">Plex server</legend>
        {servers.map((server) => (
          <label key={server.clientIdentifier} className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name="serverId"
              value={server.clientIdentifier}
              checked={selected === server.clientIdentifier}
              onChange={() => setSelected(server.clientIdentifier)}
            />
            {server.name}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !selected}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Finishing setup..." : "Use this server"}
      </button>
    </form>
  );
}
