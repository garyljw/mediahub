@AGENTS.md

# MediaHub

One web UI for Radarr (movies) and Sonarr (TV), self-hosted on a Synology DS425+ (x86-64, 2 GB RAM) on the owner's LAN. Radarr/Sonarr run on a different LAN machine.

## Stack
Next.js 16 (App Router, TypeScript, `src/` dir) · Tailwind v4 + shadcn/ui · TanStack Query · Better Auth · SQLite via Drizzle · Zod · Vitest.

## Security rules (non-negotiable)
1. **API keys never reach the browser.** All Radarr/Sonarr calls live in `src/server/**`, and every file there starts with `import "server-only";`.
2. **Read config only via `env()` from `src/server/env.ts`.** Never read `process.env` directly elsewhere, and never prefix secrets with `NEXT_PUBLIC_`.
3. **No open pass-through proxy.** Each upstream action is an explicit route handler or server action that:
   - calls `requireRole(...)` first (only `await connection()` may come before it, because it just stops Next prerendering the route),
   - validates input with Zod,
   - calls a typed client function,
   - returns only the fields the UI needs.
4. **Role checks are enforced on the server.** Hiding a button is a UX nicety, not security. Roles are `admin` (everything) and `requester` (browse, search TMDB/TVDB, add, trigger a release search for library movies and for library series, seasons or episodes, view queue/calendar/history; no delete, edit, monitoring changes or settings).
5. **Never commit real secrets.** `.env.example` holds placeholders only, and real values go in `.env.local`. A gitleaks pre-commit hook enforces this; don't bypass it with `--no-verify`.
6. **Don't log API keys, session tokens or full upstream URLs that contain `apikey=`.** Send the key as the `X-Api-Key` header, not as a query parameter.

## Conventions
- Use the generated Radarr/Sonarr types in `src/server/arr/generated/`. Don't hand-write upstream response types or guess endpoints.
- Don't state how Radarr/Sonarr behave (what a search covers, what a flag changes) in UI text or comments unless it has been checked against their source or a live instance. If it hasn't, leave the claim out.
- Merge logic goes in `src/server/merge/` as pure functions with Vitest tests that use JSON fixtures in `src/server/merge/__fixtures__/`.
- Prefer server components. Add `"use client"` only for interactivity.
- Text that a client component renders must come out identical on the server and in the browser. Don't format it with `Intl`, `toLocaleString` or `toLocaleDateString`: Node and the browser ship different ICU data (Node printed "Sept" where Safari printed "Sep"), which causes hydration errors. Use the helpers in `src/components/library/format.ts`, with dates in UTC.
- Show posters with `Poster` and `usePosterPreview` from `src/components/poster/`. Every list with poster thumbnails gets the hover preview.
- Keep runtime memory small: no extra services, and no heavy dependencies without a reason.
- Before finishing a task, run `npm run lint && npm run typecheck && npm test`. All three must pass.

## Workflow (Opus or Sonnet plans, Haiku codes)
1. The planner writes a scoped task brief with acceptance criteria. Opus plans High-tier changes and anything that changes what a role may do. Sonnet may plan Low-tier changes. Opus still runs every review.
   - If a task needs Opus planning and this session isn't on Opus, tell Gary to run `/model opus` before planning starts. Don't plan in a subagent: planning needs this conversation.
   - A session that isn't on Opus runs the step 3 reviews in an Opus agent (`model: "opus"`, `effort: "high"`), and checks that the agent's report shows each review actually ran.
2. A Haiku agent implements it, runs lint, typecheck and test, and **pastes the output tails**. Saying "it passes" isn't enough.
3. Opus runs `/code-review` on every change. It also runs `/security-review` on anything touching auth, roles, `src/server/**`, route handlers, env/secrets, headers, CI workflows or the Dockerfile. Reviews follow [REVIEW.md](REVIEW.md), which covers the round cap, diff-only re-review and severity tags.
   - Skip both reviews when a change touches only Markdown files, unless one of them sets rules for how changes are made or reviewed: `CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, anything under `.github/` or `.claude/`. Those still get `/code-review`. CI still has to pass.
4. Fix the findings (or send them back to Haiku), re-check, then commit on a feature branch and open a PR to `main` using the PR template.
5. Claude runs the rest of the git flow: wait for green CI, squash-merge, switch back to an updated `main`, delete the branch. This applies to both risk tiers. Never merge with failing CI or unresolved Important findings, never use `--no-verify`, never force-push.
6. After merging a High change, walk Gary through it in plain language: what changed, how it's protected, and what was tested. Post the same walkthrough as a comment on the merged PR, so there's a record even if the session ends.
7. If a review finding comes up more than once, fix it at the source with a lint rule, a CLAUDE.md line or a REVIEW.md line, not just in the code.

## Risk tiers (set by what the change touches, not by who wrote it)
- **High:** auth, roles, `src/server/**`, route handlers, env/secrets, headers, `.github/workflows/**`, the Dockerfile. Needs `/security-review` as well as `/code-review`, and a walkthrough for Gary after merge.
- **Low:** everything else, e.g. UI, docs, copy, tests. Can merge on green CI plus clean reviews.
- Gary has chosen post-merge walkthroughs over pre-merge diff reads, because MediaHub only runs on his LAN. He can read any merged diff and ask for a revert.

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
