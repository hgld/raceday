# Race Day — build instructions for Claude Code

Read `SPEC.md` first, then `design/DESIGN-BRIEF.md`. The mockups in `design/` are the visual target; `reference/` is a working v1 prototype whose logic (milestone maths, share-link encoding, .ics export) you should reuse rather than reinvent.

## Ground rules

- Static site, no backend, no accounts. Vanilla HTML/CSS/JS (ES2020, no framework, no build step) unless a step in SPEC.md says otherwise. It must deploy as plain files to Vercel.
- The Regatta Central link is the only thing the owner types. Everything else is looked up by the `enrich` script (SPEC.md §6) or has a sensible default.
- Share links are read-only. There is no code path from a crew view to the editor.
- Match the mockups: palette, type (Barlow / Barlow Condensed / IBM Plex Mono via Google Fonts), spacing and hierarchy. Do not introduce a new visual style.
- Mobile first. The crew view is used on a phone, outdoors, one-handed. Hit targets ≥ 44px, digits tabular, screen kept awake while the clock is visible.
- Work through `TASKS.md` in order; each task ends with the check listed there. Commit after each task.
- Never invent competitor results or race times. If enrichment can't find a value, leave it absent and let the UI show its "not published yet" state.
