# MediaHub

One web UI for Radarr and Sonarr. Private, LAN-only, self-hosted on Synology.

## Dev setup
1. `brew install node gitleaks`
2. `npm install` (this also enables the secret-scanning git hook)
3. `cp .env.example .env.local` and fill in real values. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
4. `npm run db:migrate` creates the SQLite database at `DATABASE_PATH` (default `./data/mediahub.db`). A missing data directory is created with owner-only permissions (0700), and a new database file is created owner-only (0600). An existing directory is left as it is, so if you point `DATABASE_PATH` at a shared directory, that directory is your responsibility. Re-running it is safe. After pulling new code, run it again. Until you do, MediaHub reports that the database needs updating.
5. Create the first admin: `npm run create-admin -- --email <your email>`. You are prompted for a password twice, with input hidden. It must be at least 12 characters.
6. `npm run dev`, then open http://localhost:3000 and sign in.
7. As an admin, open Settings -> Connections and enter the Radarr and Sonarr addresses and API keys (Radarr or Sonarr: Settings -> General -> API Key). Each one is tested before it is saved. The keys are stored in the database, not in `.env.local`.

Sign-up is disabled, so accounts only come from the scripts below.

## Managing users
All commands prompt for passwords and never accept them as arguments.

| Task | Command |
| --- | --- |
| Create an admin | `npm run create-admin -- --email <email> [--name "Name"]` (shortcut for `--role admin`) |
| Create a requester | `npm run create-user -- --email <email> --role requester [--name "Name"]` |
| Change a user's role | `npm run create-user -- --email <email> --role admin\|requester --set-role` |
| Reset a password | `npm run create-user -- --email <email> --reset-password` |

- `--role` has no default, so a user is never made an admin by accident.
- `--reset-password` signs the user out of all existing sessions. It also repairs a user who was created without a password.
- There is no email reset. If you lose the only admin's password, run `--reset-password` from the NAS shell.
- If setting a new user's password fails after the user row is created, the script tries to remove that partial user and exits with an error. If the removal also fails, it says so, and `--reset-password` for that email repairs it.
