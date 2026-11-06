"use client";

import "./globals.css";
import { ErrorPanel } from "@/components/error/error-panel";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Error · MediaHub</title>
        <main className="mx-auto w-full max-w-md px-4 py-16">
          <ErrorPanel error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
