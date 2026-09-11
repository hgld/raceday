# Build order

Do these in sequence. Each ends with a check; commit after each.

1. **Scaffold.** `index.html`, `r/index.html`, `styles.css`, `src/core.js` (schedule maths, formatting, encode/decode, timezone helpers — ported from `reference/app.js`), `src/view.js` (render functions shared by both modes), `src/owner.js` (editor + storage), `scripts/enrich.mjs`, `races/` for JSON, `vercel.json` (clean URLs, `/r` rewrite). Check: both pages load with no console errors on an empty state.
2. **Core + tests.** Node test file for: milestone times from the spreadsheet example; delay shifting; countdown formatting boundaries (59:59 → 1:00:00, 23:59:59 → 1d 00h); encode/decode round-trip including compression fallback; timezone rendering for `America/Toronto` from a UTC device. Check: `node --test` green.
3. **Crew view.** Build `/r/` to match `design/Main.dc.html`: identity, clock block (all four states from `design/ClockStates.dc.html`), timeline, plan, intel cards, kit, footer, wake lock. Drive it from `races/muskoka-fall-classic-2026-e24.json` during development. Check: screenshots at 390px for the four clock states; compare to the mockups.
4. **Owner view.** Race list, import via `#import=`, editor form, save/version bump, copy crew link, delete, calendar export. Check: create → edit → copy link → open link in private window → read-only.
5. **Enrichment script.** RC parsing, preceding event, venue map URL, format inference, prior-results lookup, `--merge`. Check: run against the Muskoka link; print a field-by-field found/missing report; commit the resulting JSON.
6. **Polish.** Dark mode, print stylesheet (timeline + plan on one page), reduced-motion, focus states, Lighthouse. Check: acceptance list in `SPEC.md` §11.
7. **Deploy.** Push to GitHub (`hgld` org), connect Vercel, disable Deployment Protection, verify the crew link opens in a logged-out browser.
