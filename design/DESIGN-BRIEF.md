# Race Day — page redesign

A design brief for the next version of the race countdown page. No code; this is what the page should be, why, and what data it needs.

## What the page is for

One rower, one phone, one race. The page answers three questions in order of urgency: *what do I do next*, *when do we go hands on*, *when do we race*. Everything else on the page (plan, kit, competitors) is there to be read once in the car park, not glanced at while carrying the boat. So the top of the page is a clock; the bottom of the page is a briefing.

## Two modes, one page

**Owner mode** is the page you open from your own device. Your saved races are listed, you can create, edit, delete, and generate share links.

**Crew mode** is what a share link opens. It shows exactly one race, read-only, with no race switcher, no edit button, no "save to my races", and no way to reach the editor. The link carries the race data; the viewer can only read it. If you change the plan later, you send a new link (the page shows a small "plan version" stamp — e.g. *v3 · updated Fri 21:05* — so the crew can tell whether they have the latest one).

The share link should be short enough to paste in WhatsApp without looking like a ransom note. That means the link carries an ID plus a compact copy of the data, and the page never asks the viewer to log in.

## Page structure (top to bottom)

### 1. Identity block

- **Title: the event.** *Mens Masters (21+) 4+* — big, condensed type, the first thing the eye lands on.
- **Sub-line: the regatta.** *Muskoka Fall Classic · Event #24 · Saturday 12 September 2026.*
- **Venue line:** *Gull Lake Rotary Park, Gravenhurst* with a **Map** link (opens Google Maps / Apple Maps on the phone, using the venue coordinates or a "venue name, town" search if no coordinates). Optional second pin: trailer / car parking, if known.
- **Race time** as a plain fact on the right: *11:50 am*.
- Small links: Regatta Central entry, results page (once results exist).

### 2. The clock

Three cells, always visible without scrolling on a phone.

**NEXT (most prominent by position, top of the block).** The name of the next milestone, the clock time it happens, and a live countdown to it. When the current phase is running it also says what you're supposed to be doing right now (*Now: on-land stretch and warm-up*). This is the line that changes most often and the one people are actually looking for.

**HANDS ON (largest number).** Countdown to the hands-on milestone. This is the commit point — the last moment you can still be doing something else — so it gets the biggest digits. Once hands-on has passed, this cell collapses into a small "hands on ✓ 10:55" chip and the race-start cell takes over the big digits.

**RACE START (secondary).** Countdown to race start, smaller digits, always present. After the start it flips to "Started 11:50 · +4 min".

Behaviour notes:
- More than a day out, the cells show *days + hours* rather than a ticking clock, and the NEXT cell says *Arrive by 9:35 am Saturday*.
- Delays are a fact of regattas. A single **"running late by ___ min"** field on the race shifts every milestone at once and puts a visible orange *"+15 min — schedule adjusted"* badge in the clock block. In crew mode this appears when the owner sends an updated link.
- Keep the screen awake while the clock is showing (wake lock), because the phone is going to be propped on a trestle.

### 3. Timeline

The full list of milestones, worked back from race start exactly as the spreadsheet does: each row shows the clock time, the T-minus, the step, and its duration. Past rows are struck through and dimmed; the current row is highlighted with a coloured edge; the hands-on and race-start rows are visually heavier than the rest so they can be found at a glance.

### 4. Race intel (AI-enriched)

This is the new section. It is a set of cards, each one carrying a small *source · fetched when* stamp so it's obvious what's data and what's guesswork.

- **Preceding event.** The event immediately before yours on the draw (*#23 Womens Masters 2x, 11:44*). Useful for judging whether the regatta is running late: if #23 hasn't started by its time, yours won't either.
- **Lane / bow number.** Shown for side-by-side sprints; hidden entirely for head races (the race has a `format` field: *sprint* or *head*). For head races the equivalent is *start order / bow number* and *start interval*.
- **Competitors.** One row per crew: club, crew or boat name, bow/lane, and where known **past performance** — best time this season at this distance, last result against you, the age category and handicap (Masters D vs E matters for adjusted times). A short AI-written summary sits above the table: *"Six crews. Western Reserve won this event last year in 3:37; you were 4th at 3:53 adjusted. London Western is an E crew, so they carry a bigger handicap."*
- **Course & conditions (optional).** Distance, direction of race, stream/wind note if the regatta publishes one; a link to the course map.

The enrichment is a separate block in the data, keyed by source, so it can be refreshed without touching the plan you wrote. Fields the AI may fill:

| field | example | source |
|---|---|---|
| event.number, event.name, event.time | 24, Mens Masters (21+) 4+, 11:50 | Regatta Central event page |
| event.precedingEvent | #23 Womens Masters 2x, 11:44 | RC schedule |
| race.format | sprint / head | inferred from regatta type |
| race.distance | 1000 m | RC regatta info |
| venue.name, venue.mapUrl | Gull Lake Rotary Park, maps link | RC venue page |
| entry.lane / entry.bow | lane 4 | RC draw / heat sheet |
| competitors[] | club, crew, lane, ageCategory | RC competitors list |
| competitors[].history[] | 3:37.81 (Muskoka 2025, 1st) | RegattaMaster / RC results |
| summary | one paragraph | AI, over the above |
| enrichedAt, sources[] | timestamps + URLs | provenance |

**The only input you provide is the Regatta Central link.** From that one URL the AI resolves everything in the identity block — event name and number, regatta name, date, scheduled time, venue and map link — then picks the preceding event from the draw, pulls the competitor list, and looks for prior results for those clubs at that event and distance. Anything it can't find is simply absent, not invented, and the page shows a small *"race time not yet published — check RC"* note if the schedule isn't out. You then only confirm the race time if it changes, adjust milestones or the plan if you want, and generate the share link. Creating a race is therefore: paste link → review → share.

### 5. Race plan

Your focus note, as now, in a single highlighted block. Room for two or three short lines rather than one.

### 6. Kit list

The packing list, tickable, with ticks stored per device. Present in both modes (crew members want to tick their own list).

### 7. Footer

*Add to calendar* (.ics with the timeline in the description), and in owner mode: *Edit*, *Copy share link*, *Refresh intel*.

## Visual direction

Keep the current identity — warm off-white ground, navy for structure, teal accent, orange for "now", condensed uppercase display type, tabular monospaced digits for anything that ticks. The change is hierarchy, not palette: the event name is the headline, and the clock block gets the vertical space it needs on a phone before anything else appears. Dark mode stays, and should be the recommended mode outdoors on a bright day (higher contrast, less glare).

## Data model (shape only)

```
race
  id, planVersion, updatedAt
  event        { name, number, regatta, date, time, timezone, format: sprint|head, distance }
  venue        { name, town, mapUrl, parkingMapUrl? }
  links        { regattaCentral, results? }
  delayMinutes
  milestones[] { label, minutes, kind: normal|handsOn|raceStart }
  plan         (text)
  kit[]        (strings)
  intel        { precedingEvent, lane|bow, competitors[], summary, sources[], enrichedAt }
```

`kind: handsOn` is what lets the clock block find the hands-on step regardless of what you called it or where it sits in the list.

## Things deliberately left out

- No editing in crew mode, no comments, no shared ticks — the page is a briefing, not a group chat.
- No live results polling; results are fetched by the AI on request and stamped with a time.
- No accounts. The link is the access control.
