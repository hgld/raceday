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

Prints a field-by-field found/missing report, a crew link, and an owner import
link (`/#import=<payload>`) that adds the race to the browser.

## Docs

`SPEC.md` (requirements), `TASKS.md` (build order), `design/` (mockups and the
design brief), `reference/` (the v1 prototype).
