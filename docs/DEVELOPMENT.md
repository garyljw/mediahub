# Developing MediaHub

Notes for working on MediaHub itself. To install and use it, see the [README](../README.md).
How changes are planned, reviewed and merged is in [CLAUDE.md](../CLAUDE.md) and [REVIEW.md](../REVIEW.md).

## Dev setup
1. `brew install node gitleaks`
2. `npm install` (this also enables the secret-scanning git hook)
3. `cp .env.example .env.local` and fill in real values. `BETTER_AUTH_SECRET` is optional: when it's unset, MediaHub generates one and stores it in the database. If you set it yourself (`openssl rand -base64 32`), it overrides the stored one, and changing it signs everyone out.
4. `npm run db:migrate` creates the SQLite database at `DATABASE_PATH` (default `./data/mediahub.db`). A missing data directory is created with owner-only permissions (0700), and a new database file is created owner-only (0600). An existing directory is left as it is, so if you point `DATABASE_PATH` at a shared directory, that directory is your responsibility. Re-running it is safe. After pulling new code, run it again. Until you do, MediaHub reports that the database needs updating.
5. `npm run dev`, then open http://localhost:3000/setup and sign in with Plex. Pick the Plex server you own. The Plex account that owns it becomes MediaHub's admin, and setup signs you in. Until setup is done, the first person to finish it becomes the admin.
6. As an admin, open Settings -> Connections and enter the Radarr and Sonarr addresses and API keys (Radarr or Sonarr: Settings -> General -> API Key). Each one is tested before it is saved. The keys are stored in the database, not in `.env.local`.

Sign-up is disabled. Admins come from Plex setup, and requesters come from Settings → Users or the script in "Managing users from a dev checkout" below.

## Self-contained package
`npm run package` builds `dist/mediahub/`, a folder that runs MediaHub with only a Node binary: no repo, no `npm install`, no dev tools. Copy it anywhere and run it with your config file:

```
node --env-file=<config> dist/mediahub/mediahub.mjs
```

On start it applies pending database migrations, then serves the app. `MEDIAHUB_HOST` and `MEDIAHUB_PORT` (see `.env.example`, default `0.0.0.0:7979`) set where it listens. The break-glass tools are in `dist/mediahub/tools/`, for example `node --env-file=<config> dist/mediahub/tools/create-user.mjs --email <email> --role requester`. They behave like the npm scripts in "Managing users from a dev checkout" below. `npm start` runs the same package from this repo, using `.env.local`. Run `npm run package` first, and again after code changes, because `npm start` doesn't rebuild.

This folder is the basis for the Windows installer (see the README) and the Docker image planned next.

## Making a release
1. Bump `version` in `package.json` (and `package-lock.json`, with `npm version <x.y.z> --no-git-tag-version`).
2. Publish a GitHub release tagged `v<version>` or `v<version>-rc.N`. The tag must match `package.json`, or the release workflow fails.
3. The release workflow builds the installer on Windows, tests it (install, upgrade, uninstall), and attaches `MediaHub-Setup-<version>.exe`, its `.sha256` and `build-info.json` to the release. It bundles the newest Node patch for the `.node-version` major.
4. Once a month a workflow checks whether a newer Node patch is out and opens an issue if so. To ship it, publish a new release.

## Update signing
The Windows install checks GitHub for newer releases and installs them (see "Updates" in the README). Each release carries an update manifest, signed with Ed25519:

- `update-manifest.json` holds `schema`, `product`, `version`, `installer` (`MediaHub-Setup-<version>.exe`), `sha256` and `size` of the installer.
- `update-manifest.json.sig` is the base64 Ed25519 signature over the exact bytes of the manifest.
- The publish job signs the manifest after it has hashed the uploaded installer. It checks the signature against `installer/update-public-key.pem` before uploading.
- The private key is only in the GitHub `release` environment, as the secret `UPDATE_SIGNING_KEY`. The environment should allow only `v*` tags. Only the "Sign the update manifest" step reads the secret.
- The public key is in two places: `installer/update-public-key.pem` and `src/server/updater/public-key.ts`. A test fails if they differ.

A release whose tag has `-rc.N` must be marked as a pre-release on GitHub. The version decides the channel, not that flag.

**How the updater runs.** Two SYSTEM scheduled tasks, both registered by the installer (`installer/MediaHub-Updater.xml`, `installer/MediaHub-UpdateInstall.xml`):

- `MediaHub\Updater` runs `tools/updater.mjs` from the app folder every minute. It acts only in the 03:00 hour or on a request in `updates\requests\`. It downloads and verifies an update, copies `node.exe` and itself into `updates\run\` with a `job.json`, starts `MediaHub\UpdateInstall` and exits, so the installer can replace `<APP>\node.exe`.
- `MediaHub\UpdateInstall` has no trigger. It runs that copy with `--stage2`: it checks the job again, stops the service, runs the installer with `/UPDATER`, waits for the new version, rolls back if needed, and re-registers both tasks last of all. Setup skips registering the tasks when it gets `/UPDATER`, because it isn't known whether re-registering a task stops a running instance of it.

**The database during an update.** The updater runs as SYSTEM and never reads, copies or deletes anything in the data folder, because the service account can write there and could redirect those file operations with links. The launcher (`mediahub.mjs`, running as the service account) handles the database instead, in `src/server/db/update-safety.ts`:

- Before it migrates an existing database, it saves a copy with SQLite's backup API (`<db>.pre-update`, written to a temp file and renamed). The copy's newest migration is read from the copy itself.
- If the database is newer than its own migrations, it restores that copy only when the updater has left `updates\restore-db.json` less than an hour old (only SYSTEM and Administrators can write there), and the copy was made at its own newest migration. Otherwise it refuses to start. The updater writes the marker before it runs the previous installer, and removes it afterwards.
- The launcher finds the updates folder through `MEDIAHUB_UPDATES_DIR`, which the service config (`installer/MediaHub.xml`) sets.

**Rotating the key:** generate a new Ed25519 pair, replace the `UPDATE_SIGNING_KEY` secret, replace both public-key copies, and publish a release. Installs that trust the old key can't verify the new release, so each of them needs one manual install of that release.

## Managing users from a dev checkout
All commands prompt for passwords and never accept them as arguments.

| Task | Command |
| --- | --- |
| Create a requester | `npm run create-user -- --email <email> --role requester [--name "Name"]` |
| Change a requester's role | `npm run create-user -- --email <email> --role requester --set-role` |
| Reset a requester's password | `npm run create-user -- --email <email> --reset-password` |
| Set Plex up again (break-glass) | `npm run reset-plex-admin` |

- `--role` has no default, and the script never creates or makes an admin. It refuses admin changes and admin password resets.
- `reset-plex-admin` asks you to type RESET. It clears the Plex setup, signs out every admin, and leaves requesters alone. Then open /setup again.
- `--reset-password` signs the user out of all existing sessions. It also repairs a user who was created without a password.
- There is no email reset. If you lose access to Plex, run `reset-plex-admin` from an administrator Command Prompt (see "Users and recovery" in the README).
- If setting a new user's password fails after the user row is created, the script tries to remove that partial user and exits with an error. If the removal also fails, it says so, and `--reset-password` for that email repairs it.
