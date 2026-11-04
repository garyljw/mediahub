# MediaHub

One web UI for Radarr and Sonarr. Private, LAN-only, self-hosted on Synology.

## Dev setup
1. `brew install node gitleaks`
2. `npm install` (this also enables the secret-scanning git hook)
3. `cp .env.example .env.local` and fill in real values. `BETTER_AUTH_SECRET` is optional: when it's unset, MediaHub generates one and stores it in the database. If you set it yourself (`openssl rand -base64 32`), it overrides the stored one, and changing it signs everyone out.
4. `npm run db:migrate` creates the SQLite database at `DATABASE_PATH` (default `./data/mediahub.db`). A missing data directory is created with owner-only permissions (0700), and a new database file is created owner-only (0600). An existing directory is left as it is, so if you point `DATABASE_PATH` at a shared directory, that directory is your responsibility. Re-running it is safe. After pulling new code, run it again. Until you do, MediaHub reports that the database needs updating.
5. `npm run dev`, then open http://localhost:3000/setup and sign in with Plex. Pick the Plex server you own. The Plex account that owns it becomes MediaHub's admin, and setup signs you in. Until setup is done, the first person to finish it becomes the admin.
6. As an admin, open Settings -> Connections and enter the Radarr and Sonarr addresses and API keys (Radarr or Sonarr: Settings -> General -> API Key). Each one is tested before it is saved. The keys are stored in the database, not in `.env.local`.

Sign-up is disabled. Admins come from Plex setup, and requesters come from the script below.

## Self-contained package
`npm run package` builds `dist/mediahub/`, a folder that runs MediaHub with only a Node binary: no repo, no `npm install`, no dev tools. Copy it anywhere and run it with your config file:

```
node --env-file=<config> dist/mediahub/mediahub.mjs
```

On start it applies pending database migrations, then serves the app. `MEDIAHUB_HOST` and `MEDIAHUB_PORT` (see `.env.example`, default `0.0.0.0:7979`) set where it listens. The break-glass tools are in `dist/mediahub/tools/`, for example `node --env-file=<config> dist/mediahub/tools/create-user.mjs --email <email> --role requester`. They behave like the npm scripts above. `npm start` runs the same package from this repo, using `.env.local`. Run `npm run package` first, and again after code changes, because `npm start` doesn't rebuild.

This folder is the basis for the Windows installer and the Docker image planned next.

## Admin and Plex
- Admins sign in only with Plex. The Plex account must own the server chosen during setup. Password sign-in is refused for admins.
- Requesters keep email and password sign-in.
- Setup can only be finished once. A second setup attempt gets an "already set up" reply.

## Managing users
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
- There is no email reset. If you lose access to Plex, run `reset-plex-admin` from the NAS shell.
- If setting a new user's password fails after the user row is created, the script tries to remove that partial user and exits with an error. If the removal also fails, it says so, and `--reset-password` for that email repairs it.
