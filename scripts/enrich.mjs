// Turn a Regatta Central event link into a race JSON.
//
//   node scripts/enrich.mjs <event-url> [--out races/<id>.json]
//                                       [--merge races/<id>.json]
//                                       [--capture .capture/<id>]
//                                       [--us "Argonaut"] [--summary "…"]
//
// One request per page, a User-Agent that says who we are, and no crawling.
// Every field is read independently: a field RC has not published, or that RC
// has moved, comes out absent — never guessed.
//
// RC sits behind a Cloudflare bot challenge, so a plain fetch is often refused.
// This script does not try to get around that: it says so, and names the pages
// to save from a browser for `--capture` to read instead.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  findEvent,
  inferFormat,
  isChallenge,
  looseMatch,
  mapUrl,
  parseCompetitors,
  parseEvents,
  parseEventUrl,
  parseOverview,
  parsePriorRegattaIds,
  parseResultsList,
  parseXtabResults,
  precedingEvent,
  urls,
} from './rc.mjs';

import { normaliseRace, slug, crewUrl, importUrl, encodeRace } from '../src/core.mjs';

const UA =
  'RaceDay/1.0 (personal race-day countdown page for one crew; +https://github.com/hgld/raceday)';
const POLITE_GAP_MS = 1200;

/* -------------------------------------------------------------------- args */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

/* ------------------------------------------------------------------ report */

const report = [];
const note = (field, value, source) =>
  report.push({ field, value: value == null || value === '' ? null : value, source });

function printReport() {
  const width = report.reduce((n, r) => Math.max(n, r.field.length), 0);
  console.log('\nField-by-field\n' + '─'.repeat(width + 40));
  for (const r of report) {
    const label = r.field.padEnd(width);
    if (r.value == null) console.log(`  ✗ ${label}  not published`);
    else console.log(`  ✓ ${label}  ${String(r.value).slice(0, 70)}${r.source ? '   [' + r.source + ']' : ''}`);
  }
  const found = report.filter((r) => r.value != null).length;
  console.log('─'.repeat(width + 40));
  console.log(`  ${found} found · ${report.length - found} not published\n`);
}

/* ---------------------------------------------------------------- fetching */

let lastFetch = 0;
const sources = [];

async function politeDelay() {
  const wait = POLITE_GAP_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
}

/**
 * Read one URL: from the capture directory when there is one, otherwise over
 * the network. Returns { text, from } or { error }.
 */
async function get(name, url, opts) {
  const capture = opts && opts.capture;
  if (capture) {
    try {
      const text = await readFile(join(capture, name), 'utf8');
      return { text, from: 'capture/' + name, url };
    } catch (e) {
      if (opts.required) return { error: `missing ${join(capture, name)}`, url };
      return { error: 'not captured', url };
    }
  }
  await politeDelay();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
    });
    const text = await res.text();
    if (isChallenge(text)) return { error: 'blocked by Cloudflare bot check', url, challenge: true };
    if (!res.ok) return { error: `HTTP ${res.status}`, url };
    sources.push({ url, fetchedAt: new Date().toISOString() });
    return { text, from: 'network', url };
  } catch (e) {
    return { error: e.message, url };
  }
}

function asJson(result) {
  if (!result || result.error) return result;
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch (e) {
    return { error: 'response was not JSON', url: result.url };
  }
}

function challengeHelp(regattaId, eventId) {
  const wanted = [
    ['overview.html', urls.overview(regattaId)],
    ['events.json', urls.eventsApi(regattaId)],
    ['competitors.json', eventId ? urls.competitorsData(regattaId, eventId) : null],
    ['results-list.html', urls.resultsList(regattaId)],
    ['history.html', urls.history(regattaId)],
  ].filter(([, url]) => url);

  console.error('\nRegatta Central refused the request: Cloudflare is challenging it as a bot.');
  console.error('Nothing here tries to get around that. Save the same pages from the browser');
  console.error('you already browse RC in, then re-run against the saved copies:\n');
  console.error(`  mkdir -p .capture/${regattaId}`);
  for (const [name, url] of wanted) {
    console.error(`  ${name.padEnd(20)} <- ${url}`);
  }
  console.error('\n  For an HTML page: open it and use File > Save Page As (page source is enough).');
  console.error('  For a .json URL:  open it and save, or DevTools > Network > Copy response.');
  console.error(`\n  node scripts/enrich.mjs <event-url> --capture .capture/${regattaId}\n`);
}

/* ------------------------------------------------------- prior-year results */

/**
 * Look for this event's results at the previous one or two editions. Anything
 * ambiguous is skipped; clubs are matched on a normalised name.
 */
async function priorResults(regattaId, eventName, clubs, opts) {
  const out = { byClub: new Map(), checked: [], leads: [] };
  const history = await get('history.html', urls.history(regattaId), opts);
  if (history.error) return out;

  const priorIds = parsePriorRegattaIds(history.text, regattaId).slice(0, 2);
  for (const priorId of priorIds) {
    const list = await get(`results-list-${priorId}.html`, urls.resultsList(priorId), opts);
    if (list.error) continue;
    const parsed = parseResultsList(list.text);
    out.checked.push({ regattaId: priorId, posted: parsed.posted, note: parsed.note });
    if (!parsed.posted) {
      // RC has nothing, but regattas often say where the times went.
      for (const url of parsed.links) out.leads.push({ regattaId: priorId, url });
      continue;
    }
    for (const link of parsed.links.filter((l) => /xtabResults/i.test(l))) {
      const abs = link.startsWith('http') ? link : new URL(link, urls.overview(priorId)).href;
      const page = await get(`xtab-${priorId}.html`, abs, opts);
      if (page.error) continue;
      for (const row of parseXtabResults(page.text, eventName)) {
        const club = clubs.find((c) => looseMatch(c, row.club));
        if (!club) continue;
        const existing = out.byClub.get(club);
        if (existing && existing.place <= row.place) continue;
        out.byClub.set(club, {
          event: eventName,
          time: row.time,
          adjusted: false,
          place: row.place,
          source: abs,
        });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventUrl = args._[0];
  if (!eventUrl) {
    console.error(
      'usage: node scripts/enrich.mjs <regatta-central-event-url> [--out file] [--merge file] [--capture dir] [--us name] [--summary text]'
    );
    process.exit(1);
  }

  const ids = parseEventUrl(eventUrl);
  if (!ids || !ids.regattaId) {
    console.error('That does not look like a Regatta Central event link.');
    process.exit(1);
  }
  const { regattaId } = ids;
  const eventId = ids.eventId;
  const opts = { capture: typeof args.capture === 'string' ? args.capture : null };
  const usNeedle = typeof args.us === 'string' ? args.us : 'Argonaut';

  console.log(`Regatta ${regattaId}${eventId ? ' · event ' + eventId : ''}`);
  console.log(opts.capture ? `Reading captured pages from ${opts.capture}` : 'Fetching from Regatta Central');

  /* --- the regatta header ------------------------------------------------ */
  const overview = await get('overview.html', urls.overview(regattaId), opts);
  if (overview.challenge) {
    challengeHelp(regattaId, eventId);
    process.exit(2);
  }
  const head = overview.error ? {} : parseOverview(overview.text);
  if (overview.error) console.log(`  ! overview: ${overview.error}`);

  note('regatta', head.regatta, overview.from);
  note('venue.name', head.venueName, overview.from);
  note('venue.town', head.venueTown, overview.from);
  note('event.date', head.date, overview.from);
  note('host', head.host, overview.from);
  note('event type', head.eventType, overview.from);

  /* --- the draw ---------------------------------------------------------- */
  const eventsRes = asJson(await get('events.json', urls.eventsApi(regattaId), opts));
  const events = eventsRes.error ? [] : parseEvents(eventsRes.json);
  if (eventsRes.error) console.log(`  ! events: ${eventsRes.error}`);

  const ours = eventId ? findEvent(events, eventId) : null;
  const before = precedingEvent(events, ours);

  note('event.name', ours && ours.name, eventsRes.from);
  note('event.number', ours && ours.number, eventsRes.from);
  note('event.time', ours && ours.raceTime, eventsRes.from);
  note(
    'preceding event',
    before ? `#${before.number} ${before.name} ${before.raceTime || ''}`.trim() : null,
    eventsRes.from
  );

  /* --- the entry list ---------------------------------------------------- */
  const compRes = eventId
    ? asJson(await get('competitors.json', urls.competitorsData(regattaId, eventId), opts))
    : { error: 'no event id in the link' };
  const entries = compRes.error ? [] : parseCompetitors(compRes.json);
  if (compRes.error) console.log(`  ! competitors: ${compRes.error}`);

  const live = entries.filter((e) => !e.scratched);
  note('competitors', live.length ? `${live.length} crews` : null, compRes.from);

  const us =
    live.find((e) => e.boatLabel && looseMatch(e.boatLabel, usNeedle)) ||
    live.find((e) => looseMatch(e.club, usNeedle)) ||
    null;
  note('our crew', us ? `${us.club}${us.boatLabel ? ' · ' + us.boatLabel : ''}` : null, compRes.from);

  const format = inferFormat({
    eventType: head.eventType,
    regatta: head.regatta,
    eventName: ours && ours.name,
    distance: null,
  });
  note('event.format', format, head.eventType ? 'stated by RC' : 'inferred');
  note('bow / lane', us && us.bow != null ? us.bow : null, compRes.from);

  /* --- results ----------------------------------------------------------- */
  const resultsRes = await get('results-list.html', urls.resultsList(regattaId), opts);
  const resultsInfo = resultsRes.error ? null : parseResultsList(resultsRes.text);
  note('links.results', resultsInfo && resultsInfo.posted ? urls.resultsList(regattaId) : null, resultsRes.from);

  const prior = await priorResults(
    regattaId,
    ours && ours.name,
    live.map((e) => e.club),
    opts
  );
  note(
    'prior results',
    prior.byClub.size ? `${prior.byClub.size} of ${live.length} crews` : null,
    prior.checked.length ? 'checked ' + prior.checked.map((c) => c.regattaId).join(', ') : null
  );
  for (const lead of prior.leads) {
    console.log(`  · ${lead.regattaId} published times elsewhere: ${lead.url}`);
  }

  /* --- build ------------------------------------------------------------- */
  const competitors = live.map((e) => ({
    club: e.club,
    crew: [e.boatLabel, e.avgAge ? 'avg ' + e.avgAge : null].filter(Boolean).join(' · ') || null,
    lane: format === 'sprint' ? e.bow : null,
    bow: format === 'head' ? e.bow : null,
    ageCategory: e.division,
    isUs: us ? e === us : false,
    history: prior.byClub.has(e.club) ? [prior.byClub.get(e.club)] : [],
  }));

  const fetchedAt = new Date().toISOString();
  const captureSources = opts.capture
    ? [
        { url: urls.overview(regattaId), fetchedAt, note: 'captured from a browser session' },
        { url: urls.eventsApi(regattaId), fetchedAt, note: null },
        eventId ? { url: urls.competitorsData(regattaId, eventId), fetchedAt, note: null } : null,
      ].filter(Boolean)
    : sources;

  let race = normaliseRace({
    id: slug(
      [head.regatta || 'race', (head.date || '').slice(0, 4), ours && ours.number ? 'e' + ours.number : '']
        .filter(Boolean)
        .join(' ')
    ),
    planVersion: 1,
    updatedAt: fetchedAt,
    event: {
      name: ours && ours.name,
      number: ours && ours.number,
      regatta: head.regatta,
      date: (ours && ours.date) || head.date,
      time: ours && ours.raceTime,
      timezone: typeof args.timezone === 'string' ? args.timezone : 'America/Toronto',
      format,
      distance: null, // RC does not publish it for this regatta
    },
    venue: {
      name: head.venueName,
      town: head.venueTown,
      mapUrl: mapUrl(head.venueName, head.venueTown),
      parkingMapUrl: null,
    },
    links: {
      regattaCentral: eventId ? urls.eventPage(regattaId, eventId) : urls.overview(regattaId),
      draw: urls.heatSheet(regattaId),
      results: resultsInfo && resultsInfo.posted ? urls.resultsList(regattaId) : null,
    },
    delayMinutes: 0,
    milestones: [],
    plan: '',
    kit: [],
    intel: {
      precedingEvent: before
        ? { number: before.number, name: before.name, time: before.raceTime }
        : null,
      lane: format === 'sprint' && us ? us.bow : null,
      bow: format === 'head' && us ? us.bow : null,
      startInterval: null,
      competitors,
      summary: typeof args.summary === 'string' ? args.summary : '',
      sources: captureSources,
      enrichedAt: fetchedAt,
    },
  });

  /* --- merge ------------------------------------------------------------- */
  if (typeof args.merge === 'string') {
    const existing = normaliseRace(JSON.parse(await readFile(args.merge, 'utf8')));
    race = normaliseRace({
      ...race,
      id: existing.id,
      // Owner-authored fields survive enrichment untouched.
      planVersion: existing.planVersion,
      delayMinutes: existing.delayMinutes,
      milestones: existing.milestones,
      plan: existing.plan,
      kit: existing.kit,
      venue: { ...race.venue, parkingMapUrl: existing.venue.parkingMapUrl },
      intel: {
        ...race.intel,
        summary: typeof args.summary === 'string' ? args.summary : existing.intel.summary,
      },
    });
    console.log(`\nMerged into ${args.merge}: kept milestones, plan, kit, delay and plan version.`);
  }

  printReport();

  const outPath =
    typeof args.out === 'string' ? args.out : typeof args.merge === 'string' ? args.merge : null;
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(race, null, 2) + '\n');
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(JSON.stringify(race, null, 2));
  }

  const origin = (typeof args.origin === 'string' ? args.origin : 'https://raceday.vercel.app').replace(/\/+$/, '') + '/';
  const payload = await encodeRace(race);
  console.log(`\npayload  ${payload.length} chars`);
  console.log(`crew     ${crewUrl(payload, origin)}`);
  console.log(`import   ${importUrl(payload, origin)}`);
  if (!race.milestones.length) {
    console.log('\nNo milestones yet — open the owner page, import the race and set the plan.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
