# MediaHub

One web page for running Radarr (movies) and Sonarr (TV) together, instead of switching between the two.

MediaHub is a hobby project. It started as an experiment in building a web app with [Claude Code](https://claude.com/claude-code), and nearly all of it was written that way, under a fixed set of review and security rules (see [CLAUDE.md](CLAUDE.md)). It is not a serious product: there is no support, no roadmap promise and no warranty. It runs on my home network and does what I need. You are welcome to use it, copy it or change it under the [MIT licence](LICENSE).

## What it does
- **Home:** one poster grid of everything in Radarr and Sonarr, with one search box that covers your library and finds new titles to add (from TMDB and TVDB). Rest the pointer on a poster for half a second and its year, genres and synopsis appear beside it, on Home and on the Focus lists.
- **Adding:** one click adds a movie or series using the defaults an admin has chosen. Admins can also pick the quality profile and other options.
- **Movie and series pages:** see and edit an item, change monitoring for a series, season or episode, start a search and pick a specific release.
- **Queue:** what is downloading, with remove and force import.
- **Calendar and History** for both Radarr and Sonarr.
- **Phones and tablets:** on a narrower screen (a phone, or a tablet held upright) a tab bar along the bottom replaces the sidebar: **Home**, **Movie Focus**, **TV Focus**, **Queue** and **More**. **More** holds **Calendar**, **History**, **Settings** (admins) and **Sign out**. Queue and History show each item as a card, and Calendar always shows the day list on a phone.
- **Plex watched status (optional):** watched banners on posters, and watched markers on seasons and episodes. On Home, the **Any / Unwatched / Partly watched / Watched** chips show only titles in that state. Titles that aren't in Plex appear only under **Any**.
- **Two roles:**
  - *Admins* can do everything. They sign in with the Plex account that owns your Plex server.
  - *Requesters* can browse, search, add (with the admin's defaults), start release searches, manage the Focus lists, and view the queue, calendar and history. They can't delete, edit, change monitoring or open Settings. They sign in with a name or email and password.

## Focus lists
Focus lists are two short, household-wide lists you order by hand: **Movie Focus** (movies only) and **TV Focus** (series only). Everyone who can sign in sees the same lists.

- **Adding and removing:** on Home, right-click a poster, or press and hold it on a touch screen, and choose **Add to Movie Focus** or **Add to TV Focus**. The same menu offers **Remove from** once a title is in its list. A movie's or series' page has the same button, **Add to Movie Focus** or **Add to TV Focus**, next to **Search**; it becomes **Remove from Movie Focus** or **Remove from TV Focus** once the title is in its list. A small bookmark on a poster marks a title that is in a list.
- **Searching:** the box above the posters on **Movie Focus** or **TV Focus** searches for titles to add. Titles in your library that aren't in the list come first, up to ten. Then come titles that aren't downloaded yet, found on TMDB (movies) or TVDB (TV). **Add** puts a library title in the list. For a title that isn't downloaded yet, **Add** also adds it to Radarr or Sonarr: requesters get the admin's default options, and admins press **Add…** to choose them first.
- **Reordering:** open **Movie Focus** or **TV Focus** from the sidebar, or from the tab bar along the bottom of the screen on a narrower screen (a phone, or a tablet held upright). Drag a poster to move it. On a touch screen, press and hold, then drag. With a keyboard, focus a poster, press Space, move with the arrow keys, then press Space or Enter. Or use the **⋯** button on a poster for **Move to front**, **Move earlier**, **Move later**, **Move to end** and **Remove from Focus**. A tap or click still opens the title.
- **Who can change them:** admins and requesters can add, remove and reorder. The order is saved as soon as you drop a poster, and everyone sees it on their next load.
- **Deleted titles:** if a title in a Focus list is no longer in Radarr or Sonarr, the list shows a notice with a **Remove them** button (or **Remove it** for one title). Nothing is removed until you press it, and the notice doesn't appear when the app can't be reached.
- **In Plex:** when Plex is connected (**Settings → Connections**), each list also appears in Plex as a collection of the same name, pinned to Home. On Plex Home, each row sits at the top of its own library's rows, so the library that comes first decides which list shows first. To put TV Focus first, drag your TV library above your movie library in the Plex Web sidebar. MediaHub keeps the collection in step with its list: after each change, and when someone opens Home or a Focus page after the last sync was over five minutes earlier. Anything changed in Plex is put back to match MediaHub, so titles added to a collection in Plex are removed and its order is reset. A rename or unpinning done in Plex is kept. A title that isn't in Plex yet is left out, and is added once it's there, the next time someone opens MediaHub. Disconnecting Plex leaves the collections as they are. To stop MediaHub changing them, set `MEDIAHUB_PLEX_FOCUS_SYNC=false` in `C:\ProgramData\MediaHub\mediahub.env` and restart the MediaHub service; the collections stay in Plex as they are.

MediaHub is meant for a home network only. Don't expose it to the internet.

## What you need
- A Windows 10 or 11 PC (64-bit). The PC that already runs Radarr and Sonarr is the natural place.
- Radarr and Sonarr, and their API keys (in each app: Settings → General → API Key).
- A Plex Media Server you own. Admin sign-in uses your Plex account. MediaHub keeps no Plex password.

## Install
1. Download `MediaHub-Setup-<version>.exe` from the newest [release](https://github.com/garyljw/mediahub/releases) and run it as administrator. The installer isn't code-signed, so Windows SmartScreen may warn you: choose "More info", then "Run anyway".
2. The installer asks for:
   - the **app address**: the URL you'll type in your browser, by default `http://<this PC's name>:7979`;
   - the **port**: 7979 by default. It must be free;
   - the **time zone**: read from Windows.

   A silent install (`/VERYSILENT`) uses the defaults.
3. When it finishes, MediaHub opens in your browser. **Finish setup straight away:** sign in with Plex and pick the Plex server you own. That Plex account becomes MediaHub's admin. Until setup is finished, the first person on your network to complete it becomes the admin.
4. As the admin, open **Settings → Connections** and add Radarr and Sonarr (address and API key). Each connection is tested before it's saved. You can also connect Plex there to show watched status.
5. Under **Settings → Add defaults**, choose what a one-click add uses: the quality profile, the root folder and, for series, what to monitor.
6. Under **Settings → Users**, add requesters.

### Where things are
- **Program files:** `C:\Program Files\MediaHub`. This holds the app, the Node runtime it runs on and the service wrapper. Nothing personal is kept here.
- **Settings, database, logs and image cache:** `C:\ProgramData\MediaHub` (`mediahub.env`, `data\`, `logs\`).
  - Only Administrators and SYSTEM can change this folder. By default the MediaHub service runs as SYSTEM, so it can change everything in the folder. If you give the service another account, that account can read the folder and write only to `data\`, `logs\` and the update requests folder.
  - If the folder already exists and holds something a non-administrator created, the installer refuses to continue, because someone could have planted settings there.
- **Firewall:** a rule named `MediaHub` allows the port on **Private** networks only. Your Windows network profile must be set to Private.
- **Service:** MediaHub runs as a Windows service named MediaHub. It starts with Windows and restarts if it stops unexpectedly.

### Upgrading
Run the newer installer. It stops the service, replaces the program files and starts the service again. Your settings, database and logs are kept, and `mediahub.env` is never rewritten. Running the same version again repairs an install in the same way.

### Updates
MediaHub checks GitHub every night between 03:00 and 04:00 (the PC's time). If there is a newer signed release, it installs it by itself. The MediaHub service is stopped for a minute or two while this happens.

Before a new version changes the database, it saves a copy next to it (`mediahub.db.pre-update`). If the new version doesn't start, MediaHub puts back the previous version and that copy of the database, and it doesn't try that version again overnight.

Admins can see the installed version, the last check and its result in Settings → Updates. "Check for updates now" there asks the updater to check within a minute, including versions it stopped retrying overnight.

- To turn off the overnight check, set `MEDIAHUB_AUTO_UPDATE=false` in `C:\ProgramData\MediaHub\mediahub.env`. The updater reads the file at each check, so you don't need to restart the service.
- The log is `C:\ProgramData\MediaHub\updates\updater.log` (open it as an administrator).
- Installing a newer installer by hand still works, as described above.
- Installing an older version by hand works only if the newer one didn't change the database. Otherwise MediaHub doesn't start and its log says why. Install the newer version again.
- Release candidates (versions ending in `-rc.N`): an install of a release candidate also takes newer release candidates. An install of a normal release never takes a release candidate.

### Uninstalling
Go to Settings → Apps → MediaHub → Uninstall. Your data is kept unless you answer Yes when asked to delete it; the default is No. A silent uninstall (`unins000.exe /VERYSILENT`) always keeps the data.

### Running the service as your own account (optional)
By default the service runs as the built-in `LocalSystem` account, which has full administrator rights on this PC. MediaHub installs its own updates, so it needs that. To use a Windows account of your own:

1. Open the Services app (services.msc). Go to MediaHub → Properties → Log On → "This account", and enter the account and its password. Windows gives the account the "Log on as a service" right when you set it here. MediaHub doesn't need administrator rights to run, but self-updates need the service to run as `LocalSystem` or as an administrator account. With any other account, MediaHub can't install updates.
2. Run the same MediaHub installer again as administrator. It keeps the account, gives it access to `C:\ProgramData\MediaHub` and starts the service.

Until you do step 2, the service can't read its settings and won't start.

### Changing the port or address
1. Open `C:\ProgramData\MediaHub\mediahub.env` as an administrator.
2. Edit `BETTER_AUTH_URL` (the address) or `MEDIAHUB_PORT`.
3. If you changed the port, replace the firewall rule from an administrator Command Prompt:

   ```
   netsh advfirewall firewall delete rule name="MediaHub"
   netsh advfirewall firewall add rule name="MediaHub" dir=in action=allow protocol=TCP localport=<port> profile=private
   ```

4. Restart the MediaHub service, either in services.msc or with `sc stop MediaHub` then `sc start MediaHub`.

Running the installer again doesn't change an existing `mediahub.env`.

## Users and recovery
Admins manage requesters in **Settings → Users**: add one, set a new password (which also signs them out everywhere), sign them out everywhere, or delete them. Anyone can create an account only through an admin, because sign-up is turned off.

For the times you can't use the web page, `mediahub-tool.cmd` in the install folder does the same jobs. Run it from an **administrator** Command Prompt. It asks for passwords itself and never takes them as arguments.

| Task | Command |
| --- | --- |
| Create a requester | `"C:\Program Files\MediaHub\mediahub-tool.cmd" create-user --email <email> --role requester --name "Name"` |
| Make an existing user a requester | `"C:\Program Files\MediaHub\mediahub-tool.cmd" create-user --email <email> --role requester --set-role` |
| Reset a requester's password | `"C:\Program Files\MediaHub\mediahub-tool.cmd" create-user --email <email> --reset-password` |
| Set up the Plex admin again | `"C:\Program Files\MediaHub\mediahub-tool.cmd" reset-plex-admin` |
| Apply database updates by hand | `"C:\Program Files\MediaHub\mediahub-tool.cmd" migrate` |

- The tool never creates an admin or changes one. Admins come only from Plex setup.
- `reset-plex-admin` asks you to type RESET. It clears the Plex setup and signs every admin out, and leaves requesters alone. Then open `/setup` in your browser and sign in with Plex again. Use it if you lose access to the Plex account.
- There's no password reset by email.

## Troubleshooting
- **The page won't load from another device:** check that the Windows network profile is Private, and that the firewall rule exists (`netsh advfirewall firewall show rule name="MediaHub"`).
- **The service won't start:** look at `MediaHub.err.log` and `MediaHub.out.log` in `C:\ProgramData\MediaHub\logs` (open them as an administrator). If you changed the service's account, run the installer again (see [above](#running-the-service-as-your-own-account-optional)).
- **A page says "Something went wrong":** press **Try again**. If it shows an error code, search for that code in `MediaHub.err.log` in `C:\ProgramData\MediaHub\logs` (open it as an administrator) to see what failed.
- **"Port is already in use" during install:** another program uses that port. Pick a different one.

## Licence
[MIT](LICENSE). Use it however you like, at your own risk.
