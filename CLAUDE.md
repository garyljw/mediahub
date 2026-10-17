@AGENTS.md

# MediaHub

One web UI for Radarr (movies) and Sonarr (TV), self-hosted on a Synology DS425+ (x86-64, 2 GB RAM) on the owner's LAN. Radarr/Sonarr run on a different LAN machine.

## Stack
Next.js 16 (App Router, TypeScript, `src/` dir) · Tailwind v4 + shadcn/ui · TanStack Query · Better Auth · SQLite via Drizzle · Zod · Vitest.

## Security rules (non-negotiable)
1. **API keys never reach the browser.** All Radarr/Sonarr calls live in `src/server/**`, and every file there starts with `import "server-only";`.
2. **Read config only via `env()` from `src/server/env.ts`.** Never read `process.env` directly elsewhere, and never prefix secrets with `NEXT_PUBLIC_`.
3. **No open pass-through proxy.** Each upstream action is an explicit route handler or server action that:
   - calls `requireRole(...)` first,
   - validates input with Zod,
   - calls a typed client function,
   - returns only the fields the UI needs.
4. **Role checks are enforced on the server.** Hiding a button is a UX nicety, not security. Roles are `admin` (everything) and `requester` (browse, search, add, view queue/calendar/history; no delete, edit or settings).
5. **Never commit real secrets.** `.env.example` holds placeholders only, and real values go in `.env.local`. A gitleaks pre-commit hook enforces this; don't bypass it with `--no-verify`.
6. **Don't log API keys, session tokens or full upstream URLs that contain `apikey=`.** Send the key as the `X-Api-Key` header, not as a query parameter.

## Conventions
- Use the generated Radarr/Sonarr types in `src/server/arr/generated/`. Don't hand-write upstream response types or guess endpoints.
- Merge logic goes in `src/server/merge/` as pure functions with Vitest tests that use JSON fixtures in `src/server/merge/__fixtures__/`.
- Prefer server components. Add `"use client"` only for interactivity.
- Keep runtime memory small: no extra services, and no heavy dependencies without a reason.
- Before finishing a task, run `npm run lint && npm run typecheck && npm test`. All three must pass.

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
