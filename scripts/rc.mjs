// Everything this project knows about Regatta Central's URLs and markup lives
// here, so when RC changes its pages there is one file to fix.
//
// RC's v3 pages are server-rendered shells that pull their tables from two
// JSON endpoints. We prefer those endpoints and only scrape HTML for the
// regatta header (name, venue, town, date, event type), which has no API.

export const RC_ORIGIN = 'https://www.regattacentral.com';

/* -------------------------------------------------------------------- URLs */

export const urls = {
  eventPage: (r, e) => `${RC_ORIGIN}/v3/regatta/${r}/event/${e}/competitors`,
  competitorsData: (r, e) => `${RC_ORIGIN}/v3/regatta/${r}/event/${e}/competitors/data`,
  eventsApi: (r) => `${RC_ORIGIN}/v3/api/regatta/${r}/events`,
  overview: (r) => `${RC_ORIGIN}/v3/regatta/${r}`,
  resultsList: (r) => `${RC_ORIGIN}/v3/regatta/results-list?job_id=${r}&org_id=0`,
  history: (r) => `${RC_ORIGIN}/v3/cms2/regatta/${r}/history?org_id=0`,
  heatSheet: (r) => `${RC_ORIGIN}/v3/cms2/regatta/${r}/heat_sheet?org_id=0`,
  venue: (v) => `${RC_ORIGIN}/venues/venue.jsp?venue_id=${v}`,
};

/** Pull the regatta and event ids out of any RC event link. */
export function parseEventUrl(input) {
  const url = String(input || '');
  const v3 = /\/v3\/regatta\/(\d+)\/event\/(\d+)/.exec(url);
  if (v3) return { regattaId: v3[1], eventId: v3[2] };
  const legacy = /job_id=(\d+)/.exec(url);
  const legacyEvent = /event_id=(\d+)/.exec(url);
  if (legacy) return { regattaId: legacy[1], eventId: legacyEvent ? legacyEvent[1] : null };
  const bare = /\/v3\/regatta\/(\d+)/.exec(url);
  if (bare) return { regattaId: bare[1], eventId: null };
  return null;
}

/* ------------------------------------------------------------ html helpers */

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
};

export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
}

export function stripTags(html) {
  return decodeEntities(
    String(html == null ? '' : html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The innerHTML of the first element carrying `attr="value"`, counting nested
 * tags of the same name so we stop at the matching close tag.
 */
export function elementByAttr(html, attr, value) {
  const open = new RegExp(`<([a-z0-9]+)([^>]*\\b${attr}\\s*=\\s*"[^"]*\\b${value}\\b[^"]*")[^>]*>`, 'i');
  const m = open.exec(html);
  if (!m) return null;
  const tag = m[1];
  let depth = 1;
  let at = m.index + m[0].length;
  const start = at;
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  scan.lastIndex = at;
  let hit;
  while ((hit = scan.exec(html))) {
    depth += hit[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, hit.index);
    at = scan.lastIndex;
  }
  return html.slice(start);
}

/* ------------------------------------------------------- dates and times */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Sept 12, 2026" / "September 12, 2026" / "2026-09-12" -> "2026-09-12". */
export function toIsoDate(text) {
  const s = String(text || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/** "11:50 AM" -> "11:50"; "2:00 PM" -> "14:00". */
export function to24h(text) {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(String(text || '').trim());
  if (!m) {
    const plain = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
    return plain ? `${String(Number(plain[1])).padStart(2, '0')}:${plain[2]}` : null;
  }
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function mapUrl(name, town) {
  const q = [name, town].filter(Boolean).join(', ');
  if (!q) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

/* ------------------------------------------------------- the regatta header */

/** Is this response Cloudflare's bot challenge rather than the page? */
export function isChallenge(html) {
  const s = String(html || '').slice(0, 4000);
  return /Just a moment|cf-challenge|challenge-platform|cf_chl_opt/i.test(s);
}

/**
 * The header block on every regatta page:
 *   Muskoka Fall Classic
 *   Gull Lake Rotary Park | Gravenhurst, ON (CAN) Sept 12, 2026
 *   Host: Georgian Bay Rowing Club | Event Type: Head
 * Each field is read independently: a markup change costs one field, not the run.
 */
export function parseOverview(html) {
  const out = {
    regatta: null,
    venueName: null,
    venueTown: null,
    venueId: null,
    date: null,
    host: null,
    eventType: null,
  };
  const h = String(html || '');

  try {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h);
    if (title) {
      const clean = decodeEntities(title[1]).replace(/\s*-\s*RegattaCentral\s*$/i, '').trim();
      out.regatta = clean.split('|')[0].trim() || null;
    }
  } catch (e) {
    /* leave regatta null */
  }

  try {
    const block = elementByAttr(h, 'class', 'venue-name');
    if (block) out.venueName = stripTags(block) || null;
  } catch (e) {
    /* leave venueName null */
  }

  try {
    const m = /venue_id=(\d+)/.exec(h);
    if (m) out.venueId = m[1];
  } catch (e) {
    /* leave venueId null */
  }

  try {
    const block = elementByAttr(h, 'itemprop', 'location');
    if (block) {
      // "Gravenhurst , ON (CAN)" -> "Gravenhurst, ON"
      const text = stripTags(block)
        .replace(/\s*\(\s*[A-Z]{3}\s*\)\s*$/, '')
        .replace(/\s+,/g, ',')
        .trim();
      out.venueTown = text || null;
    }
  } catch (e) {
    /* leave venueTown null */
  }

  try {
    const block = elementByAttr(h, 'itemprop', 'startDate');
    if (block) out.date = toIsoDate(stripTags(block));
  } catch (e) {
    /* leave date null */
  }

  try {
    const block = elementByAttr(h, 'class', 'rc-host-name');
    if (block) out.host = stripTags(block).replace(/^Host:\s*/i, '') || null;
  } catch (e) {
    /* leave host null */
  }

  try {
    const m = /Event\s*Type:(?:&nbsp;|\s)*<span[^>]*>([^<]+)<\/span>/i.exec(h);
    if (m) out.eventType = decodeEntities(m[1]).trim() || null;
  } catch (e) {
    /* leave eventType null */
  }

  return out;
}

/* ------------------------------------------------------------------ events */

/** `/v3/api/regatta/<id>/events` -> one row per event, in running order. */
export function parseEvents(json) {
  if (!Array.isArray(json)) return [];
  return json
    .map((e) => ({
      eventId: String(e.eventId),
      number: e.eventLabel == null ? null : String(e.eventLabel).trim(),
      name: (e.description || '').replace(/\s+/g, ' ').trim(),
      raceTime: to24h(e.raceTime),
      date: toIsoDate(e.dayLabel),
      dayIndex: Number(e.dayIndex) || 0,
      boatCount: Number(e.boatCount) || 0,
      gender: e.gender || null,
      sortOrder: Number(e.eventSortOrder) || 0,
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder);
}

export function findEvent(events, eventId) {
  return events.find((e) => e.eventId === String(eventId)) || null;
}

/** The event immediately before ours on the draw. */
export function precedingEvent(events, event) {
  if (!event) return null;
  const i = events.findIndex((e) => e.eventId === event.eventId);
  return i > 0 ? events[i - 1] : null;
}

/* ------------------------------------------------------------- competitors */

/** `/…/competitors/data` -> one row per entered boat. */
export function parseCompetitors(json) {
  if (!Array.isArray(json)) return [];
  return json.map((c) => {
    // RC shows "0" until bow numbers and lanes are drawn.
    const raw = String(c.bow == null ? '' : c.bow).trim();
    const bow = raw && raw !== '0' ? Number(raw) || null : null;
    return {
      club: (c.organization || c.longName || '').trim(),
      shortName: (c.shortName || '').trim() || null,
      boatLabel: (c.boatLabel || '').trim() || null,
      bow,
      seed: (c.seed || '').trim() || null,
      division: (c.divisionTitle || '').trim() || null,
      handicap: Number(c.handicap) || 0,
      avgAge: Number(c.avgAge) || null,
      scratched: String(c.status || '').toUpperCase() === 'SCRATCHED',
      lineup: (c.formattedLineup || '')
        .split(/<br\s*\/?>/i)
        .map((s) => stripTags(s))
        .filter(Boolean),
    };
  });
}

/** RC's own statement of head vs sprint, else the spec's inference. */
export function inferFormat({ eventType, regatta, eventName, distance }) {
  if (eventType && /head/i.test(eventType)) return 'head';
  if (eventType && /sprint/i.test(eventType)) return 'sprint';
  if (/\bhead\b/i.test(regatta || '') || /\bhead\b/i.test(eventName || '')) return 'head';
  if (distance && Number(distance) >= 4000) return 'head';
  return 'sprint';
}

/* ----------------------------------------------------------------- results */

/** The results index for a regatta: has anything been posted, and where. */
export function parseResultsList(html) {
  const h = String(html || '');
  const main = elementByAttr(h, 'class', 'rc-main') || h;
  const text = stripTags(main);
  const posted = !/None posted/i.test(text);
  const links = [...h.matchAll(/href="([^"]*(?:xtabResults|results[^"]*job_id|crewtimer)[^"]*)"/gi)].map(
    (m) => decodeEntities(m[1])
  );
  const external = [...text.matchAll(/https?:\/\/[^\s"<]+/g)].map((m) => m[0]);
  return { posted, note: text.slice(0, 300), links: [...new Set([...links, ...external])] };
}

/** Earlier editions of the same regatta, newest first. */
export function parsePriorRegattaIds(html, selfId) {
  const ids = [...String(html || '').matchAll(/\/v3\/regatta\/(\d+)\?org_id=/g)].map((m) => m[1]);
  return [...new Set(ids)].filter((id) => id !== String(selfId)).sort((a, b) => Number(b) - Number(a));
}

/**
 * RegattaMaster cross-tab results: rows of place / crew / time. Kept simple
 * and strict — anything that does not look like a result row is skipped
 * rather than guessed at.
 */
export function parseXtabResults(html, eventName) {
  const rows = [];
  const h = String(html || '');
  const tables = [...h.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  for (const table of tables) {
    const label = stripTags(table).slice(0, 200);
    if (eventName && !looseMatch(label, eventName)) continue;
    for (const tr of [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0])) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 3) continue;
      const place = /^(\d{1,2})$/.exec(cells[0]) ? Number(cells[0]) : null;
      const time = cells.find((c) => /^\d{1,2}:\d{2}(\.\d{1,2})?$/.test(c)) || null;
      const club = cells.find((c) => c.length > 2 && !/^\d/.test(c)) || null;
      if (place == null || !time || !club) continue;
      rows.push({ place, club, time });
    }
  }
  return rows;
}

/** Club names differ between sources ("Argonaut" vs "Argonaut Rowing Club"). */
export function normaliseClub(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(rowing|boat|club|association|assn|crew|team|rc|bc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function looseMatch(a, b) {
  const na = normaliseClub(a);
  const nb = normaliseClub(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
