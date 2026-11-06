"use client";

import { ErrorPanel } from "@/components/error/error-panel";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
