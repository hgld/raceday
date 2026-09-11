# Race Day — build specification

A static web app that turns a Regatta Central event link into a race-day countdown page: milestones worked backwards from race time, a live clock to hands-on and race start, the race plan, a kit list, and AI-gathered race intel. The owner builds and edits races; crew open a read-only link.

Owner: Henry Dillon (rows for Argonaut Rowing Club, Toronto). First real race: Muskoka Fall Classic, Sat 12 Sep 2026, Mens Masters (21+) 4+, event #24, https://www.regattacentral.com/v3/regatta/10552/event/14/competitors

---

## 1. Modes and routes

| route | mode | who | what |
|---|---|---|---|
| `/` | owner | Henry, on his own devices | race list, create/edit/delete, copy crew link, refresh intel |
| `/#<raceId>` | owner | same | a specific saved race |
| `/r/#<payload>` | crew | anyone with the link | one race, read-only, no navigation to anything else |

- Owner data lives in `localStorage` (`raceday.state.v2`). No sync between devices; that's acceptable.
- `/r/` is a separate HTML entry (`r/index.html`) that loads the same CSS and a `view.js` containing **only** rendering code. The editor code is never shipped to that page. The payload is the compact race encoding from §4; if it fails to decode, show a plain "This link isn't valid" screen.
- Crew mode shows the "Shared by Henry · view only" footer and hides: race switcher, edit, new race, refresh intel, running-late control. Kit ticks still work (stored per device).

## 2. Page anatomy (both modes; see `design/Main.dc.html` and `design/Owner.dc.html`)

1. **Identity**: date + scheduled race time line; **event name as H1** (e.g. *Mens Masters (21+) 4+*); regatta + event number as sub-line; venue line with pin icon and **Map** link (`venue.mapUrl`); plan version stamp (`v3 · Fri 21:05`); orange `+N MIN LATE` badge when `delayMinutes > 0`. Owner mode adds links: Regatta Central, Draw/heat sheet, Results (when present).
2. **Clock block** — §3.
3. **Timeline** — every milestone: clock time, T-minus, label, duration. States: past (dimmed, struck through), current (orange edge + tint), hands-on and race-start rows visually heavier.
4. **Race plan** — free text, pre-wrap.
5. **Race intel** — §5.
6. **Kit** — checkbox list; ticks per device keyed by race id; "n / total packed" counter.
7. **Footer** — Add to calendar (.ics). Owner mode: also Edit, Copy crew link, Refresh intel.

## 3. Clock block

Three cells. Layout per mockup: NEXT across the top; HANDS ON and RACE START side by side beneath.

- **NEXT**: label of the next milestone whose time is in the future, its clock time, `in m:ss` (or `h:mm:ss`), and beneath it `Now: <current milestone label>` when one is running. More than 24 h out: show `Arrive by <first milestone time> <weekday>` and hours/minutes rather than a ticking clock.
- **HANDS ON**: countdown to the milestone with `kind: "handsOn"`. Biggest digits on the page. Once it has passed it collapses to a small chip (`✓ 11:05`) and RACE START takes the big digits.
- **RACE START**: countdown to race start (secondary size), then after the start the whole block turns teal and shows `Racing · +m:ss elapsed` with a Results link if `links.results` exists.
- Digits: IBM Plex Mono, tabular. Format: `m:ss` under an hour, `h:mm:ss` under a day, `Nd HHh` beyond.
- Tick every second with `setInterval`; re-render only the text nodes that change (no full re-render per tick).
- Request `navigator.wakeLock` while the clock block is on screen; release on `visibilitychange` hidden.

**Delay**: `delayMinutes` shifts race time and therefore every milestone. The identity line keeps the *scheduled* time; the clock and timeline show *adjusted* times. Owner sets it with a number field; it is part of the payload so the crew see it when a new link is sent.

## 4. Data model and share payload

```jsonc
{
  "id": "muskoka-fall-classic-2026-e24",
  "planVersion": 3,
  "updatedAt": "2026-09-11T21:05:00-04:00",
  "event":   { "name": "Mens Masters (21+) 4+", "number": 24, "regatta": "Muskoka Fall Classic",
               "date": "2026-09-12", "time": "11:50", "timezone": "America/Toronto",
               "format": "sprint", "distance": 1000 },
  "venue":   { "name": "Gull Lake Rotary Park", "town": "Gravenhurst, ON",
               "mapUrl": "https://maps.google.com/?q=Gull+Lake+Rotary+Park+Gravenhurst", "parkingMapUrl": null },
  "links":   { "regattaCentral": "https://www.regattacentral.com/v3/regatta/10552/event/14/competitors",
               "draw": null, "results": null },
  "delayMinutes": 0,
  "milestones": [
    { "label": "Last significant food", "minutes": 35, "kind": "normal" },
    { "label": "Arrive, unload, rig, check boat", "minutes": 30, "kind": "normal" },
    { "label": "Change, pee, hydrate", "minutes": 20, "kind": "normal" },
    { "label": "On-land stretch and warm-up", "minutes": 30, "kind": "normal" },
    { "label": "Hands on — walk to control", "minutes": 5, "kind": "handsOn" },
    { "label": "Launch — on-water warm-up and practice", "minutes": 45, "kind": "normal" },
    { "label": "Starting area — ready to be called", "minutes": 5, "kind": "normal" }
  ],
  "plan": "FOCUS: Fast hands, SLLLLOOOWWWW recovery, especially the last quarter.",
  "kit": ["Photo ID (original — no copies)", "Singlet and navy shorts", "Water bottle", "..."],
  "intel": { /* §5 */ }
}
```

- Milestone timing: step *i* starts at `raceStart − Σ minutes[i..end]`; race start is an implicit final row. Exactly one milestone may be `kind: "handsOn"`; if none, the HANDS ON cell is hidden and RACE START gets the big digits.
- Times are wall-clock in `event.timezone`; render in that zone regardless of the viewer's device (use `Intl.DateTimeFormat` with `timeZone`). Countdowns use absolute instants.
- **Share payload**: JSON with short keys (see `reference/app.js` `encodeRace`) → UTF-8 → `CompressionStream('deflate-raw')` → base64url. Fall back to uncompressed base64url with a `u.` prefix where `CompressionStream` is unavailable. Target: under ~1,500 characters for a typical race. The payload includes `intel` so crew see it.
- `planVersion` increments on every save; `updatedAt` is set on save; both are shown in the identity block.

## 5. Race intel

A block of AI/lookup-sourced fields with provenance. Rendered as cards; any card whose data is absent is not rendered.

```jsonc
"intel": {
  "precedingEvent": { "number": 23, "name": "Womens Masters 2x", "time": "11:44" },
  "lane": 4,                       // sprint only
  "bow": null,                     // head races: bow number
  "startInterval": null,           // head races: seconds between crews
  "competitors": [
    { "club": "Western Reserve", "crew": null, "lane": 1, "ageCategory": "D",
      "history": [ { "event": "Muskoka Fall Classic 2025", "time": "3:37.81", "adjusted": true, "place": 1, "source": "https://…" } ] },
    { "club": "Argonaut", "isUs": true, "lane": 4, "ageCategory": "D", "history": [ … ] }
  ],
  "summary": "Six crews. Western Reserve won this event last year …",
  "sources": [ { "url": "https://www.regattacentral.com/…", "fetchedAt": "2026-09-11T20:40:00-04:00" } ],
  "enrichedAt": "2026-09-11T20:40:00-04:00"
}
```

- Cards: **Preceding event** (number, name, time, the hint "if it's late, so are we"); **Lane** (big digit; label switches to **Bow** for `format: "head"` and shows start interval); **Competitors** (summary paragraph, then rows: lane/bow · club · age cat · best history entry as `time · place`; our row highlighted teal; footnote naming the results source and season). Section header carries `Regatta Central · fetched <day time>`.
- Never render placeholder text where data is missing. If `event.time` is missing entirely, the clock block is replaced by a single line: *Race time not yet published — check Regatta Central* with the link.

## 6. Enrichment script (`scripts/enrich.mjs`)

Run by Claude Code (or from a terminal), not by the page. Node 20+, no paid APIs.

```
node scripts/enrich.mjs <regatta-central-event-url> [--out races/<id>.json] [--merge races/<id>.json]
```

1. Fetch the RC event page and the regatta's schedule/draw pages (`/v3/regatta/<id>/…`). Parse: regatta name, event number and name, date, scheduled time (may be absent before the draw is published), venue name and town, entry list with clubs/lanes/bows, and the event immediately preceding ours in the schedule.
2. Build `venue.mapUrl` as a Google Maps search URL from venue name + town (coordinates if RC provides them).
3. Infer `format`: head if the regatta/event name contains "Head" or distances ≥ 4000 m; else sprint. Set `distance` when RC states it.
4. For each competing club, look for prior results at this regatta/event (RC results pages, RegattaMaster `xtabResults.aspx`) from the previous one or two seasons; keep time, adjusted flag, place, source URL. Match clubs by normalised name. Skip anything ambiguous.
5. Write `summary` (2–3 sentences, plain, factual: field size, who won last year and in what time, where we placed, any handicap note). Claude Code writes this when it runs the script interactively; the script leaves it empty otherwise.
6. `--merge` keeps owner-authored fields (`milestones`, `plan`, `kit`, `delayMinutes`, `planVersion`) from the existing file and replaces only `event`, `venue`, `links`, `intel`.
7. Output: race JSON per §4, plus a printed crew link and owner import link (`/#import=<payload>`), which the app accepts to add/update a race in `localStorage`.

Parsing RC HTML is brittle; keep selectors in one module, fail per-field (not whole-run), and print what was and wasn't found. Respect RC: one request per page, a polite User-Agent, no scraping loops.

## 7. Owner editor

- Race list as pills (sorted by date); "+ New race" opens a single field: *Paste a Regatta Central event link* → runs no network in-page; instead it shows the `enrich` command to run and accepts the resulting import link. (The page cannot fetch RC itself — CORS.)
- Edit form: event fields (prefilled from enrichment, editable), date/time/timezone, venue + map URL, delay minutes, milestones table (label, minutes, kind radio, reorder, add, remove) with live computed start times, plan textarea, kit textarea (one per line).
- Save: bumps `planVersion`, sets `updatedAt`, stores locally, re-renders. **Copy crew link** builds `/r/#<payload>` from the saved state and copies it.
- Delete with confirm.

## 8. Calendar export

`.ics` with one VEVENT: DTSTART = first milestone, DTEND = race start + 15 min, SUMMARY = `<event> — <regatta> (race <time>)`, LOCATION = venue, DESCRIPTION = timeline lines + plan, URL = crew link. Reuse `reference/app.js` `downloadIcs`.

## 9. Visual system

Tokens (light): bg `#f3f1ea`, panel `#fbfaf6`, ink `#141c2b`, ink-2 `#4b5566`, ink-3 `#8a92a0`, line `#dcd8cc`, navy `#16304f`, accent `#0e7c86` (soft `#d9eef0`, ink `#0a5b63`), now `#c9541c` (soft `#fbe6da`), done `#9aa1ad`. Dark tokens in `reference/styles.css`. Fonts: Barlow (body), Barlow Condensed (display, uppercase), IBM Plex Mono (digits). Radius 6–8 px. Dark mode via `prefers-color-scheme` and `data-theme`.

## 10. Hosting

- GitHub repo under the `hgld` org, Vercel project linked to it (team *Red Squirrel Publishing*). Static output, no framework. Turn **off** Deployment Protection for the project so crew links work without a Vercel login. Add `<meta name="robots" content="noindex">`.
- Suggested domain later: a subdomain Henry already owns; not required for v1.

## 11. Acceptance

- Paste the Muskoka link → `enrich` produces a JSON with event name *Mens Masters (21+) 4+*, event #24, regatta *Muskoka Fall Classic*, venue *Gull Lake Rotary Park, Gravenhurst*, map URL, and whatever entries/times RC has published; missing fields are absent, not guessed.
- Import link adds the race; milestone times match the spreadsheet (race 11:50 → food 9:00, arrive 9:35, change 10:05, stretch 10:25, hands on 10:55, launch 11:00, start area 11:45).
- Setting delay 10 shifts every row by 10 min and shows the badge; header still says 11:50.
- Crew link opens in a private window with no edit affordances; decode round-trips exactly; payload < 1,500 chars for this race.
- Clock states at 10:55, 11:30 and 12:03 match `design/ClockStates.dc.html`.
- Lighthouse mobile ≥ 95 performance/accessibility; page works with fonts blocked (fallback stacks).
