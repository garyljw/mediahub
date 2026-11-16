// Release notes shown on the Release notes page, newest first. Plain data: no imports from src/server.
// Note text may use **bold** and nothing else (no other Markdown, no HTML, no links).
// Each release adds its entry at the top, in the same PR that bumps the version in package.json.
export type ReleaseNote = { text: string; details?: string[] };
export type ReleaseSection = { heading: string; notes: ReleaseNote[] };
export type ReleaseEntry = { version: string; date: string; sections: ReleaseSection[] };

export const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: "1.15.1",
    date: "2026-11-16",
    sections: [
      {
        heading: "Fixed",
        notes: [{ text: "**The A–Z bar on phones:** tapping a letter no longer leaves the big letter on screen." }],
      },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-11-16",
    sections: [
      {
        heading: "Improved",
        notes: [
          {
            text: "**Every title is clickable:** click a movie's or show's poster or name anywhere in MediaHub to open its page.",
            details: [
              "On **Add** and in the Focus search, a title already in your library opens its page; one that isn't opens the TMDB preview with its overview, cast and an **Add** button (this needs the TMDB token in **Settings → Connections**).",
              "On **Calendar**, **Queue** and **History**, the poster opens the page as well as the name, and a TV episode opens its episode page. A download covering several episodes still opens the show.",
            ],
          },
          {
            text: "**Breadcrumbs everywhere:** the **Add** page and the **Settings** pages show the trail back to where you came from, and an episode page opened on its own shows its show in the trail.",
          },
          {
            text: "**History on narrow screens** no longer opens the poster preview when the pointer rests on a card.",
          },
        ],
      },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-11-15",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Episode pages:** click an episode's title on a series page to open its own page, laid out like a movie page with the show's poster and backdrop: the episode's synopsis, status, file details and cast.",
            details: [
              "The cast lists the episode's regulars, then its guest stars, from TMDB. Click a photo to open that person's page. It needs the TMDB token in **Settings → Connections**, and is left out when TMDB numbers the episode differently from Sonarr.",
              "The same episode actions as the series page: **Search** for everyone; **Pick a release…**, **Monitor** / **Unmonitor** and **Delete file…** for admins.",
              "With Plex connected, the page shows whether you've watched the episode.",
            ],
          },
        ],
      },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-11-15",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**People's pages:** click an actor's photo or name in the **Cast** row of any movie or TV page to open their page, laid out like a title page: their photo, biography, birth details, a backdrop from their latest released credit and their acting filmography.",
            details: [
              "The filmography is a poster grid, newest first, with an **All** / **Movies** / **TV** switch. Titles you already have show **In library** and open their library page; anything else opens a TMDB preview.",
              "The cast on every page you reach links to people again, so you can keep following actors from title to title.",
              "Self appearances (talk and award shows) and news, reality and talk shows are left out.",
              "TV library pages now show their cast too, from TMDB, under **Seasons**.",
              "People's pages need the TMDB token in **Settings → Connections**. Without one, the cast isn't linked.",
            ],
          },
        ],
      },
      {
        heading: "Fixed",
        notes: [
          {
            text: "Some Popular previews said **TMDB sent a reply MediaHub couldn't read.** when TMDB didn't know a film's runtime or a show's season count yet. Those now show a dash instead.",
          },
        ],
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-11-15",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Choose the streaming services on Popular:** a new **Settings → Popular** page lets an admin pick which services **Popular on** offers, instead of TMDB's top 12.",
            details: [
              "Search for a service and click it to add it, then drag your list into the order you want. The Popular page starts on the first one.",
              "One list covers movies and TV. A service with nothing of that kind in your country is left out.",
              "With none picked, Popular shows TMDB's top 12 as before. **Reset to top 12** goes back to that.",
            ],
          },
        ],
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-11-14",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Popular page:** a new page in the sidebar (under **More** on a phone) showing what's popular right now, from TMDB. It has six sections: **Trending movies**, **Trending TV**, **Popular on** a streaming service you pick (with a Movies / TV switch), **Upcoming movies**, **Upcoming TV** and **On this week** (shows with an episode in the next seven days). Documentaries are left out, and TV also leaves out news, reality (including quiz and game shows), soaps and talk shows.",
            details: [
              "Titles you already have show **In library** and open their library page. Anything else opens a preview page with the synopsis, cast and an **Add** button.",
              "**Add** works like the Add page: requesters add with the admin's defaults, and admins press **Add…** to choose the options first.",
              "Posters have the same hover card as Home, and going back from a title returns you to the poster you clicked.",
            ],
          },
          {
            text: "**Set up Popular with a free TMDB token:** Popular stays off until an admin adds a TMDB token. It takes about five minutes:",
            details: [
              "**1.** Create a free account at themoviedb.org and sign in.",
              "**2.** Open your account's **Settings**, then **API**, and request an API key. Choose the personal (non-commercial) option and fill in the short form about what you'll use it for.",
              "**3.** On the same API page, copy the long **API Read Access Token**. Don't use the shorter **API Key**: MediaHub needs the Read Access Token.",
              "**4.** In MediaHub, open **Settings → Connections**, paste the token under **TMDB** and press **Save**. MediaHub checks it with TMDB before saving it, and never shows it again.",
              "**5.** Pick your **Country** (it decides which streaming services and upcoming movies you see) and an **Original language** for Upcoming TV and On this week (**Any** turns that filter off), then press **Save** again.",
              "Open **Popular** in the sidebar. To turn it off later, press **Remove** under TMDB.",
            ],
          },
        ],
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-11-14",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Genre filter:** Home can show one genre at a time, for movies and TV together (for example **Science Fiction**). Pick it under **Filters**; the list shows how many titles each genre has.",
          },
        ],
      },
      {
        heading: "Improved",
        notes: [
          {
            text: "**Filters button:** the Type and Watched chips now sit behind one **Filters** button next to the sort menu, so the toolbar takes two rows on a phone instead of four. Each filter that is on shows as a tag under the toolbar, and tapping its **x** switches it off. **Clear all** in the panel resets them.",
          },
        ],
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-11-14",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Latest release sort:** Home can sort by **Latest release**: a series by its most recently aired episode and a movie by its latest release date (cinema, digital or physical), so shows with new episodes come to the top. The old sort is now called **First released** and works as before.",
          },
        ],
      },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-11-12",
    sections: [
      {
        heading: "Improved",
        notes: [
          {
            text: "**Clear search:** the search boxes on Home, Add and the Focus pages have a clear button, so one tap empties the box and you can type a new search straight away. Escape clears it too.",
          },
        ],
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-11-12",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Episode monitoring** in a series' Settings: apply one of Sonarr's monitor presets, such as Future episodes, to a series you already have. It is applied once when you save. Sonarr doesn't record which preset was used, so MediaHub can't show it afterwards: the box always starts at No change, and the season and episode toggles show the result.",
          },
          {
            text: "**Delete files** for a season or a single episode from a series page (admins), keeping the series in Sonarr. The dialog lists every episode affected, says whether the files go to Sonarr's Recycle Bin or are deleted permanently, and lets you unmonitor them so Sonarr doesn't download them again.",
          },
        ],
      },
      {
        heading: "Improved",
        notes: [
          {
            text: "**Settings** on movie and series pages sit in two columns on wider screens, and their dropdowns now show every option instead of a scrolling list near the bottom of the screen.",
          },
          {
            text: "**Seasons** on a series page all start closed, so you open only the ones you want.",
          },
        ],
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-11-11",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**System in Settings:** a new admin page. Its first section, **Disk space**, lists each disk Radarr and Sonarr report, with its free and total space and a bar that turns red when less than 10% is free.",
          },
        ],
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-11-11",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Add carries your search:** on Home, **Add** now sits next to the search box. Press it (or Enter) and the Add page opens already searching for what you typed, with your Movies or TV choice kept. Handy when a title isn't in your library yet.",
          },
          { text: "**← Home** from the Add page brings back your Home search." },
        ],
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-11-11",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Release notes:** a new page in the menu (under **More** on a phone) lists what changed in every MediaHub release, newest first.",
          },
        ],
      },
    ],
  },
  {
    version: "1.4.1",
    date: "2026-11-11",
    sections: [
      {
        heading: "Fixed",
        notes: [
          { text: "**Movies on the Calendar link to their page**, like shows already did, in the grid, the list and the \"+N more\" pop-up." },
          { text: "**Movies in History link to their page** too." },
          {
            text: "**The back link knows where you came from:** a title opened from the Calendar, Queue or History shows **← Calendar**, **← Queue** or **← History**, and takes you back to the same month, filters and place.",
          },
        ],
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-11-10",
    sections: [
      {
        heading: "New",
        notes: [
          {
            text: "**Sort Home:** a **Sort by** menu puts the grid in order by **Title**, **Date downloaded**, **Released / aired** or **Size on disk**, with an arrow button to flip the order. Your choice is remembered in each browser.",
            details: [
              "**Date downloaded** is the later of when Radarr or Sonarr last imported the title (upgrades count) and, with Plex connected, when it arrived in Plex. Titles with neither come after, newest file first.",
              "**Released / aired** is a movie's first release (cinema, digital or physical, whichever came first) and a series' first episode.",
            ],
          },
          {
            text: "**A–Z bar:** when sorting by title, a column of letters on the right jumps to that letter. On a phone, drag along it and a big letter shows where you are.",
          },
          {
            text: "**Back to where you were:** coming back to Home or a Focus page from a title returns you to the tile you opened, with your search and filters as you left them. A reload keeps your place too. Pressing **Home** while on Home goes to the top.",
          },
        ],
      },
      {
        heading: "Fixed",
        notes: [
          {
            text: "**← Home** on a title's page now goes back to the list you came from (or **← Movie Focus** / **← TV Focus**), instead of opening a new Home at the top. Browser Back no longer walks through every title you opened.",
          },
        ],
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-11-08",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**Season packs first:** a season's **Pick a release** list starts on season packs, with a switch for **Episodes** or **All**. Big searches no longer push season packs out of the list." },
          { text: "**Sort and hide releases:** every release list can be sorted by best match, quality, size, age or seeders. **Hide qualities not in profile** (on by default) hides releases your quality profile doesn't allow and says how many it hid. Your choices are remembered in your browser." },
          { text: "**Loading:** while indexers are searched, a sliding bar and placeholder rows show instead of plain text." },
          { text: "**Replace existing file:** when picking a release, an admin can tick **Replace existing file**. If that download then isn't imported because it isn't an upgrade, MediaHub imports it anyway, replacing the existing file. The old file goes to the Recycle Bin set in Radarr's or Sonarr's Media Management settings; with none set, it is deleted for good. The Queue shows **Will replace existing file** until then." },
          { text: "**Auto-import downloads matched by ID** (Settings → Connections → Imports, off by default): imports a download Radarr or Sonarr grabbed for a movie or series but won't import because its name didn't match. Only files they match to that movie or series with no other problem are imported." },
          { text: "**MediaHub's own icon** in browser tabs and on iPhone and iPad home screens." },
        ],
      },
      {
        heading: "Fixed",
        notes: [
          { text: "**Login:** if the login page's scripts don't load, the browser no longer puts the name and password in the address bar." },
        ],
      },
    ],
  },
  {
    version: "1.2.3",
    date: "2026-11-08",
    sections: [
      {
        heading: "Fixed",
        notes: [
          { text: "**Dropdowns on Windows:** in dark mode, the option lists of dropdowns (quality profile, monitoring and the like on the Add panel, item edit pages and Settings) showed white text on a white background in Chromium browsers on Windows. They now use the dark theme's colours." },
        ],
      },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-11-07",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**About page:** open it from the menu under your name (or **More** on a phone) to see the version, a link to the project on GitHub, and the open-source projects MediaHub is built on, with their licences." },
          { text: "**Licences included:** the install folder now contains THIRD_PARTY_NOTICES.txt and MediaHub's own LICENSE.txt." },
          { text: "**Smaller install:** an unused image library (sharp) is no longer bundled." },
        ],
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-07",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**Backdrops show the good part:** on movie and series pages, the backdrop behind the header is now cropped to its most interesting part (faces, detail and colour) instead of always the middle, so wide screens stop cutting heads off. Each backdrop is worked out once, the first time you open it, and remembered in that browser." },
          { text: "**Stronger backdrop:** the backdrop is a little more visible behind the header." },
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-07",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**Wide screens:** Home's and Add's filters and **+ Add** sit right next to the search box. Posters on Home and the Focus lists grow with the window, about 12 across on a 3440px screen." },
          { text: "**Add and History:** each row shows a bigger poster with the synopsis right in the row, and its buttons sit next to the title instead of at the far edge." },
          { text: "**Focus from a title's page:** movie and series pages have an **Add to Movie Focus** / **Add to TV Focus** button next to **Search** (it becomes **Remove from …**)." },
          { text: "**Seasons in order:** Specials first, then Season 1, 2, 3. Specials are hidden when a show has none, and Season 1 opens first." },
          { text: "**Phones:** a series' episodes show as cards." },
          { text: "**Poster:** the poster on movie and series pages is no longer tilted." },
        ],
      },
      {
        heading: "Fixed",
        notes: [{ text: "The poster pop-up on Add no longer opens at the far right of a wide screen." }],
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-07",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**Neon look:** midnight blue with a red-to-purple gradient, in light and dark mode. Movie and series pages are washed with the poster's own colours." },
          { text: "**Phones and tablets:** on a narrower screen (a phone, or a tablet held upright) a tab bar along the bottom replaces the sidebar: Home, Movie Focus, TV Focus, Queue and More (Calendar, History, Settings, Sign out). Queue and History show each item as a card, and Calendar shows the day list on a phone." },
          { text: "**Hover cards:** rest the pointer on a poster on Home or a Focus list and its year, genres and synopsis appear beside it." },
          { text: "**Faster-feeling pages:** pages show loading placeholders, Home's toolbar is ready at once, and posters fade in." },
          { text: "**Plex watched status:** new colours for the watched banners, and a watch-status filter on Home (Any, Unwatched, Partly watched, Watched)." },
          { text: "**Missing titles:** posters show in greyscale when there's nothing on disk." },
          { text: "**Queue and History:** click anywhere on a row to show its details." },
          { text: "**Focus sync settings:** a second copy of MediaHub can turn Focus sync off or use its own collections." },
        ],
      },
      {
        heading: "Fixed",
        notes: [{ text: "The Add requester and Add defaults fields now line up." }],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-06",
    sections: [
      {
        heading: "New",
        notes: [
          { text: "**Focus lists:** Movie Focus and TV Focus are two short, household-wide lists you order by hand. Add or remove a title by right-clicking its poster on Home (press and hold on a touch screen). Reorder by dragging on the list's own page. You can also add titles from a Focus page, from your library or not downloaded yet; a title that isn't downloaded yet is added to Radarr or Sonarr with your Add defaults." },
          { text: "**Focus lists in Plex:** with Plex connected, each list appears in Plex as a collection of the same name, pinned to Home and kept in step with MediaHub." },
          { text: "**Error page:** when something goes wrong, MediaHub shows a friendly page with an error code instead of a crash screen." },
        ],
      },
    ],
  },
];
