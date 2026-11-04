# MediaHub

One web UI for Radarr and Sonarr. Private, LAN-only, self-hosted.

## Install on Windows
MediaHub runs as a Windows service on the PC that also runs Radarr and Sonarr. The installer does the setup for you.

1. Download `MediaHub-Setup-<version>.exe` from the newest GitHub release and run it as administrator. The installer is not code-signed, so Windows SmartScreen may warn: choose "More info", then "Run anyway".
2. The wizard asks for the **app address** (the URL you type in your browser, default `http://<this PC's name>:7979`), the **port** (default 7979) and the **time zone** (read from Windows). The port must be free. Silent installs (`/VERYSILENT`) use the defaults.
3. Finish opens MediaHub in your browser. Finish setup straight away: sign in with Plex and pick the Plex server you own. Until setup is finished, the first person on the network to complete it becomes the admin. Logs are in `C:\ProgramData\MediaHub\logs` (open them as an administrator).

Where things live:
- Program files: `C:\Program Files\MediaHub` (the Node runtime, the app and the service wrapper). Nothing user-specific is stored here.
- Settings, database, logs and image cache: `C:\ProgramData\MediaHub` (`mediahub.env`, `data\`, `logs\`). Only Administrators and SYSTEM can change it. The MediaHub service account can read it and write only to `data\` and `logs\`. If this folder already exists and holds something a non-administrator created, the installer refuses to continue, because someone could have planted settings there.
- The firewall rule `MediaHub` allows the port on **Private** networks only. Your Windows network profile must be set to Private for the rule to apply.

**Upgrading:** run the newer installer. It stops the service, replaces the program files, and starts the service again. Your settings, database and logs are kept, and `mediahub.env` is not rewritten. Running the same version again repairs the install the same way.

**Uninstalling:** Apps & features → MediaHub → Uninstall. Your data is kept unless you answer Yes to the prompt that asks to delete it (the default is No). A silent uninstall (`unins000.exe /VERYSILENT`) always keeps the data.

**Changing the port or address:** open `C:\ProgramData\MediaHub\mediahub.env` as an administrator and edit `BETTER_AUTH_URL` or `MEDIAHUB_PORT`. If the port changed, replace the firewall rule from an administrator Command Prompt:

```
netsh advfirewall firewall delete rule name="MediaHub"
netsh advfirewall firewall add rule name="MediaHub" dir=in action=allow protocol=TCP localport=<port> profile=private
```

Then restart the MediaHub service (services.msc, or `sc stop MediaHub` and `sc start MediaHub`). Running the installer again does not change an existing `mediahub.env`.

**Admin tools:** from an administrator Command Prompt, run `mediahub-tool.cmd` in the install folder, for example:

```
"C:\Program Files\MediaHub\mediahub-tool.cmd" create-user --email <email> --role requester
"C:\Program Files\MediaHub\mediahub-tool.cmd" reset-plex-admin
"C:\Program Files\MediaHub\mediahub-tool.cmd" migrate
```

These are the same break-glass tools as in Managing users below.

### Run the service as your own account (optional)
By default the service runs as the virtual account `NT SERVICE\MediaHub`. To use a Windows account you choose instead:

1. Open services.msc, then MediaHub → Properties → Log On → "This account", and enter the account and its password. Windows grants the account "Log on as a service" when you set it here. The account needs no administrator rights.
2. Re-run the same MediaHub installer as administrator. It keeps the account, gives it access to `C:\ProgramData\MediaHub`, and starts the service.

Until step 2 the service cannot read its config folder and will not start.

### Making a release (maintainer)
1. Bump `version` in `package.json` (and `package-lock.json`, with `npm version <x.y.z> --no-git-tag-version`).
2. Publish a GitHub release tagged `v<version>` or `v<version>-rc.N`. The tag must match `package.json`, or the release workflow fails.
3. The release workflow builds the installer on Windows, tests it (install, upgrade, uninstall), and attaches `MediaHub-Setup-<version>.exe`, its `.sha256` and `build-info.json` to the release. It bundles the newest Node patch for the `.node-version` major.
4. Once a month a workflow checks whether a newer Node patch is out and opens an issue if so. To ship it, publish a new release.

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

This folder is the basis for the Windows installer (see Install on Windows) and the Docker image planned next.

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
- There is no email reset. If you lose access to Plex, run `reset-plex-admin` from an administrator Command Prompt (see Windows install).
- If setting a new user's password fails after the user row is created, the script tries to remove that partial user and exits with an error. If the removal also fails, it says so, and `--reset-password` for that email repairs it.
