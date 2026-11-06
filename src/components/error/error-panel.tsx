"use client";

import { Button } from "@/components/ui/button";
import { errorDigest } from "./digest";

export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);

  return (
    <div role="alert" className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">This page hit an error. Try again, or go back to Home.</p>
      {digest ? (
        <p className="text-sm text-muted-foreground">
          Error code: <code className="font-mono">{digest}</code>
          <br />
          If it keeps happening, look up this code in MediaHub&apos;s error log.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button asChild variant="outline">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain link forces a full page load, which still works when the root layout itself has crashed. next/link would only do a client-side route change. */}
          <a href="/">Home</a>
        </Button>
      </div>
    </div>
  );
}
