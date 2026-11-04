@AGENTS.md

# MediaHub

One web UI for Radarr (movies) and Sonarr (TV). It runs as a Windows service on the PC that also runs Radarr/Sonarr, on the owner's LAN, installed by the Inno Setup installer from a GitHub release. A Docker image is planned as a second way to deploy.

## Stack
Next.js 16 (App Router, TypeScript, `src/` dir) · Tailwind v4 + shadcn/ui · TanStack Query · Better Auth · SQLite via Drizzle · Zod · Vitest.

## Security rules (non-negotiable)
1. **API keys never reach the browser.** All Radarr/Sonarr and Plex calls live in `src/server/**`, and every file there starts with `import "server-only";`.
2. **Read config only via `env()` from `src/server/env.ts` (deployment config) or `src/server/settings/` (Radarr/Sonarr connections, stored in SQLite).** Never read `process.env` directly elsewhere, and never prefix secrets with `NEXT_PUBLIC_`.
3. **No open pass-through proxy.** Each upstream action is an explicit route handler or server action that:
   - calls `requireRole(...)` first (only `await connection()` may come before it, because it just stops Next prerendering the route),
   - validates input with Zod,
   - calls a typed client function,
   - returns only the fields the UI needs.
4. **Role checks are enforced on the server.** Hiding a button is a UX nicety, not security. Roles are `admin` (everything) and `requester` (browse, search TMDB/TVDB, add (always with the admin's Add defaults; only admins pick a quality profile), trigger a release search for library movies and for library series, seasons or episodes, view queue/calendar/history; no delete, edit, monitoring changes or settings). Admins sign in only with Plex: the account must own the configured Plex server and match the stored owner account id. Password sign-in is refused for admins.
5. **Never commit real secrets.** `.env.example` holds placeholders only, and real values go in `.env.local`. A gitleaks pre-commit hook enforces this; don't bypass it with `--no-verify`.
   The repo is public, and so are PR descriptions, comments, issues and Actions logs. Keep personal details out of all of them: no names other than Gary's, no real addresses, hostnames, IPs, Plex server ids or library contents. Tests and fixtures use made-up values (`example.test`, `Fake Home Server`, `192.168.10.5`).
6. **Don't log API keys, session tokens or full upstream URLs that contain `apikey=`. Don't log Plex tokens.** Send the key as the `X-Api-Key` header, not as a query parameter.
7. **Stored API keys are write-only.** Never send a stored Arr key to the browser. Using a stored key with a different URL origin requires the key to be entered again.
8. **Plex sign-in uses Plex's PIN flow with one fixed client id and keeps no Plex token.** Never sign anyone in with a stored Plex credential. The Plex data connection (Settings → Connections) is separate: it has its own fixed client id, and its token is stored server-side, is write-only like the Arr keys (never sent to the browser), is used only to read from the Plex server, and is never used for sign-in.

## Conventions
- `README.md` is the public user guide: what MediaHub does, what it needs, and how to install, set up, upgrade, recover and uninstall it. Any PR that changes what users see or do, or how MediaHub is installed or configured, updates the README in the same PR. The README describes only what exists now, with no plans and no developer setup. Developer notes go in `docs/DEVELOPMENT.md`.
- Use the generated Radarr/Sonarr types in `src/server/arr/generated/`. Don't hand-write upstream response types or guess endpoints.
- Don't state how Radarr/Sonarr behave (what a search covers, what a flag changes) in UI text or comments unless it has been checked against their source or a live instance. If it hasn't, leave the claim out.
- Plex has no generated types: validate plex.tv replies with Zod, keeping only the fields we use, and only rely on fields checked against a live reply.
- Merge logic goes in `src/server/merge/` as pure functions with Vitest tests that use JSON fixtures in `src/server/merge/__fixtures__/`.
- Prefer server components. Add `"use client"` only for interactivity.
- Text that a client component renders must come out identical on the server and in the browser. Don't format it with `Intl`, `toLocaleString` or `toLocaleDateString`: Node and the browser ship different ICU data (Node printed "Sept" where Safari printed "Sep"), which causes hydration errors. Use the helpers in `src/components/library/format.ts`, with dates in UTC. Local times are the exception: format them on the server with `formatLocalDateTime` from `src/server/merge/local-time.ts` in `env().DISPLAY_TIMEZONE`, and pass the finished string to the client.
- Show posters with `Poster` and `usePosterPreview` from `src/components/poster/`. Every list with poster thumbnails gets the hover preview. The Home poster grid is the exception: its tiles are already full-size posters (`PosterTile`).
- Keep runtime memory small: no extra services, and no heavy dependencies without a reason.
- Before finishing a task, run `npm run lint && npm run typecheck && npm test`. All three must pass.

## Workflow (Opus or Sonnet plans, Haiku codes)
1. The planner writes a scoped task brief with acceptance criteria. Opus plans High-tier changes and anything that changes what a role may do. Sonnet may plan Low-tier changes. Opus still runs every review.
   - If a task needs Opus planning and this session isn't on Opus, tell Gary to run `/model opus` before planning starts. Don't plan in a subagent: planning needs this conversation.
   - Any agent that runs a step 3 review is started with `model: "opus"`, because a subagent's default model may be cheaper than the session's.
   - A session that isn't on Opus runs the step 3 reviews in such an agent (`effort: "high"`; that is the agent's reasoning effort, and `/code-review` still runs at the level step 3 gives), and checks that the agent's report shows each review actually ran.
2. A Haiku agent implements it, runs lint, typecheck and test, and **pastes the output tails**. Saying "it passes" isn't enough.
3. Opus runs `/code-review` at `medium`. It uses `low` only when every changed file is one of these:
   - a test or fixture outside `src/server/**` and `src/app/**`;
   - a file under `src/components/**` that, after the change, imports nothing but types from `src/server`, calls no route handler or server action, and has no `dangerouslySetInnerHTML`;
   - Markdown that isn't a rules file. A change made only of such Markdown skips review altogether (see "Skip both reviews" below).

   Type the level every time, because the skill otherwise reuses the last one.

   Opus also runs `/security-review` on any change that creates, edits or loosens a security boundary:
   - login, sessions, user management or the Better Auth config;
   - adding a server action or route handler, or changing what an existing one accepts, writes or returns;
   - anything that changes what a role may do;
   - sending upstream fields to the browser that weren't sent before;
   - the Arr client (`src/server/arr/client.ts`, `request.ts`);
   - env/secrets, security headers, `src/proxy.ts`, `next.config.ts`, DB migrations, new dependencies, CI workflows, the Dockerfile.

   When unsure, run it. Other High-tier changes skip it, such as a page or merge logic that reuses existing server functions and sends no new upstream fields to the browser. For those, `/code-review` checks the leak, access and proxy failures in REVIEW.md. Reviews follow [REVIEW.md](REVIEW.md), which covers the round cap, diff-only re-review and severity tags.
   - Skip both reviews when a change touches only Markdown files, unless one of them sets rules for how changes are made or reviewed: `CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, anything under `.github/` or `.claude/`. Those still get `/code-review`. CI still has to pass.
4. Fix the findings (or send them back to Haiku), re-check, then commit on a feature branch and open a PR to `main` using the PR template.
5. Claude runs the rest of the git flow: wait for green CI, squash-merge, switch back to an updated `main`, delete the branch. This applies to both risk tiers. Never merge with failing CI or unresolved Important findings, never use `--no-verify`, never force-push.
6. After merging a High change, walk Gary through it in plain language: what changed, how it's protected, and what was tested. Post the same walkthrough as a comment on the merged PR, so there's a record even if the session ends.
7. If a review finding comes up more than once, fix it at the source with a lint rule, a CLAUDE.md line or a REVIEW.md line, not just in the code.

## Risk tiers (set by what the change touches, not by who wrote it)
- **High:** auth, roles, `src/server/**`, route handlers, env/secrets, headers, `.github/workflows/**`, the Dockerfile. Needs `/code-review`, a `/security-review` when step 3 calls for one, and a walkthrough for Gary after merge.
- **Low:** everything else, e.g. UI, docs, copy, tests. Can merge on green CI plus clean reviews.
- MediaHub only runs on Gary's LAN and is never exposed to the internet. So security reviews target boundary changes, not every High change, and Gary has chosen post-merge walkthroughs over pre-merge diff reads (he can read any merged diff and ask for a revert). The LAN threats still apply: other devices on the network, websites open in the browser sending requests to it (CSRF, DNS rebinding), and Arr API keys that give full control of Radarr and Sonarr.

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
