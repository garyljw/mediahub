"use client";

import { useEffect, useState, useTransition } from "react";
import {
  checkPlexConnection,
  disconnectPlex,
  savePlexConnection,
  startPlexConnection,
  testPlexConnection,
  type PlexCheckResult,
} from "@/app/(app)/settings/connections/plex-actions";
import { Button } from "@/components/ui/button";

const POLL_MS = 2000;
const WAIT_LIMIT_MS = 10 * 60 * 1000;

type Option = { id: string; label: string };

type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; startedAt: number; authUrl: string }
  | { kind: "pick"; options: Option[] };

type Notice = { tone: "ok" | "error"; text: string };

/**
 * The Plex data connection. The browser only ever gets `connected`, the stored address and the server's name. The
 * tokens and the candidate addresses stay on the server; the pick list carries labels and ids only.
 */
export function PlexConnectionForm({
  connected,
  url,
  serverName,
}: {
  connected: boolean;
  url: string | null;
  serverName: string | null;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [pending, startTransition] = useTransition();

  // While waiting for approval, poll every few seconds. Leaving the phase (Cancel, success or failure) stops the timer.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { startedAt } = phase;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (Date.now() - startedAt > WAIT_LIMIT_MS) {
        if (active) {
          setPhase({ kind: "idle" });
          setNotice({ tone: "error", text: "Plex didn't approve the code in time. Start again." });
        }
        return;
      }
      let result: PlexCheckResult;
      try {
        result = await checkPlexConnection();
      } catch {
        // A thrown action (network drop, server error) would otherwise leave the page waiting forever.
        if (active) {
          setPhase({ kind: "idle" });
          setNotice({ tone: "error", text: "Couldn't check with MediaHub. Start again." });
        }
        return;
      }
      if (!active) return;
      if (!result.ok) {
        setPhase({ kind: "idle" });
        setNotice({ tone: "error", text: result.message });
        return;
      }
      if (result.status === "pick") {
        setSelected(result.options[0]?.id ?? "");
        setPhase({ kind: "pick", options: result.options });
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  function connect() {
    setNotice(null);
    // Browsers only allow a pop-up opened directly by the click, not after an await. So an empty tab is opened now
    // and pointed at Plex once the server answers. Its opener link is cut so the Plex page can't reach this one.
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof startPlexConnection>>;
      try {
        result = await startPlexConnection();
      } catch {
        popup?.close();
        setNotice({ tone: "error", text: "Couldn't start the Plex connection. Try again." });
        return;
      }
      if (!result.ok) {
        popup?.close();
        setNotice({ tone: "error", text: result.message });
        return;
      }
      // The link below the waiting text opens the same page if the browser blocked the pop-up anyway.
      if (popup) popup.location.href = result.authUrl;
      setPhase({ kind: "waiting", startedAt: Date.now(), authUrl: result.authUrl });
    });
  }

  function cancelWaiting() {
    setPhase({ kind: "idle" });
    setNotice(null);
  }

  function save() {
    startTransition(async () => {
      const result = await savePlexConnection({ optionId: selected });
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        if (result.message.startsWith("Start again")) setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "idle" });
      setReconnecting(false);
      setNotice({ tone: "ok", text: `Connected through ${result.label}. Libraries found: ${result.sections}.` });
    });
  }

  function test() {
    setNotice(null);
    startTransition(async () => {
      const result = await testPlexConnection();
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        return;
      }
      setNotice({
        tone: "ok",
        text:
          result.sections.length > 0
            ? `Plex answered. Libraries: ${result.sections.join(", ")}.`
            : "Plex answered. It lists no libraries.",
      });
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectPlex();
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        return;
      }
      setConfirmDisconnect(false);
      setReconnecting(false);
      setNotice({ tone: "ok", text: "Plex is disconnected." });
    });
  }

  if (phase.kind === "waiting") {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm">
          Waiting for approval on Plex…
        </p>
        <p className="text-sm">
          <a href={phase.authUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Open the Plex approval page again
          </a>
        </p>
        <Button type="button" variant="outline" onClick={cancelWaiting}>
          Cancel
        </Button>
        <Notices notice={notice} />
      </div>
    );
  }

  if (phase.kind === "pick") {
    return (
      <div className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Choose the address MediaHub should use</legend>
          {phase.options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="plex-address"
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
                className="size-4"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={save} disabled={pending || selected === ""}>
            Save
          </Button>
          <Button type="button" variant="outline" onClick={() => setPhase({ kind: "idle" })}>
            Cancel
          </Button>
        </div>
        <Notices notice={notice} />
      </div>
    );
  }

  if (!connected || reconnecting) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {connected ? "Choose a new address for the Plex server." : "MediaHub isn't connected to Plex yet."}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={connect} disabled={pending}>
            Connect to Plex
          </Button>
          {connected && (
            <Button type="button" variant="outline" onClick={() => setReconnecting(false)}>
              Cancel
            </Button>
          )}
        </div>
        <Notices notice={notice} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Connected to {serverName ?? "Plex"}.
        {/* Only the name is shown (Gary's choice). Saved URLs are built server-side, so plain http is always "http://". */}
        {url?.startsWith("http://") ? <span className="ml-1 text-muted-foreground">Not encrypted.</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={test} disabled={pending}>
          Test
        </Button>
        <Button type="button" variant="outline" onClick={() => setReconnecting(true)} disabled={pending}>
          Change address / reconnect
        </Button>
        {confirmDisconnect ? (
          <>
            <span className="text-sm">Disconnect Plex?</span>
            <Button type="button" variant="destructive" onClick={disconnect} disabled={pending}>
              Yes, disconnect
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={pending}>
              Keep it
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)} disabled={pending}>
            Disconnect
          </Button>
        )}
      </div>
      <Notices notice={notice} />
    </div>
  );
}

function Notices({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return notice.tone === "ok" ? (
    <p role="status" className="text-sm">
      {notice.text}
    </p>
  ) : (
    <p role="alert" className="text-sm text-destructive">
      {notice.text}
    </p>
  );
}
