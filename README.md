# Race Day

A static race-day countdown page. Milestones worked backwards from race time, a
live clock to hands-on and race start, the race plan, a kit list and race intel
looked up from Regatta Central.

- `/` — owner view: race list, create/edit/delete, copy the crew link
- `/r/#<payload>` — crew view: one race, read-only, the link carries the data

No backend, no accounts, no build step. Vanilla HTML/CSS/ES modules.

## Develop

```
node scripts/serve.mjs        # http://localhost:4173
node --test                   # core maths, formatting, encoding
```

## Build a race

```
node scripts/enrich.mjs <regatta-central-event-url> --out races/<id>.json
```

Reads the RC event page, the regatta header, the draw and the entry list; looks
for prior results at the previous editions; and prints a field-by-field
found/missing report, a crew link, and an owner import link
(`/#import=<payload>`) that adds the race to the browser. `--merge
races/<id>.json` refreshes only `event`, `venue`, `links` and `intel`, leaving
the milestones, plan, kit, delay and plan version alone. `--us "Dillon"` marks
which entry is ours; `--summary "…"` writes the intel paragraph.

Anything RC has not published comes out absent, never guessed.

### When RC blocks the fetch

Regatta Central is behind a Cloudflare bot check, so a plain HTTP fetch is
usually refused. The script does not try to get around it — it prints the list
of URLs to save from a browser you already use, and `--capture <dir>` parses
those saved copies instead:

```
node scripts/enrich.mjs <event-url> --capture .capture/10552
```

The RC parsing all lives in `scripts/rc.mjs`, with captured real responses
under `test/fixtures/rc/` as its tests.

## Docs

`SPEC.md` (requirements), `TASKS.md` (build order), `design/` (mockups and the
design brief), `reference/` (the v1 prototype).
