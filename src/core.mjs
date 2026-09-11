// Race Day — core: schedule maths, formatting, timezone helpers, share-link
// encoding, calendar export. No DOM, no state; safe to import in Node for tests.
// Ported and extended from reference/app.js.

export const MS_MIN = 60000;
export const MS_HOUR = 3600000;
export const MS_DAY = 86400000;

export const DEFAULT_TZ = 'America/Toronto';

/* ---------------------------------------------------------------- small bits */

export function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

export function slug(s) {
  return (
    String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'race'
  );
}

/* ------------------------------------------------------------------ timezone */
// Every race time is wall-clock in event.timezone. The viewer's device zone is
// irrelevant: we resolve wall-clock -> absolute instant once, then render every
// clock face back through Intl with the event's zone.

const partFormatters = new Map();
const labelFormatters = new Map();

function partsFormatter(timeZone) {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(timeZone, f);
  }
  return f;
}

function labelFormatter(timeZone, opts) {
  const key = timeZone + '|' + JSON.stringify(opts);
  let f = labelFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone }, opts));
    labelFormatters.set(key, f);
  }
  return f;
}

export function zoneOf(race) {
  const tz = race && race.event && race.event.timezone;
  if (!tz) return DEFAULT_TZ;
  try {
    partsFormatter(tz);
    return tz;
  } catch (e) {
    return DEFAULT_TZ;
  }
}

/** Calendar fields of `instant` as seen in `timeZone`. */
export function zoneParts(instant, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Milliseconds that `timeZone` is ahead of UTC at `instant`. */
export function zoneOffset(instant, timeZone) {
  const p = zoneParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/** Wall-clock fields in `timeZone` -> absolute instant (ms). */
export function wallToInstant(y, mo, d, h, mi, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const first = zoneOffset(guess, timeZone);
  let t = guess - first;
  // Re-check once: near a DST boundary the first offset can be the wrong side.
  const second = zoneOffset(t, timeZone);
  if (second !== first) t = guess - second;
  return t;
}

/** "2026-09-12" + "11:50" in `timeZone` -> instant, or null if unparseable. */
export function parseWallClock(date, time, timeZone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim());
  const t = /^(\d{1,2}):(\d{2})/.exec(String(time || '').trim());
  if (!d || !t) return null;
  const h = Number(t[1]);
  const mi = Number(t[2]);
  if (h > 23 || mi > 59) return null;
  return wallToInstant(Number(d[1]), Number(d[2]), Number(d[3]), h, mi, timeZone);
}

/** Same calendar day in `timeZone`? */
export function sameZoneDay(a, b, timeZone) {
  const pa = zoneParts(a, timeZone);
  const pb = zoneParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/* ---------------------------------------------------------------- formatting */

/** 11:50 am */
export function fmtTime(instant, timeZone) {
  const p = zoneParts(instant, timeZone);
  const ap = p.hour >= 12 ? 'pm' : 'am';
  let h = p.hour % 12;
  if (h === 0) h = 12;
  return h + ':' + pad2(p.minute) + ' ' + ap;
}

/** 11:05 — for the tight "hands on done" chip. */
export function fmtTimeShort(instant, timeZone) {
  const p = zoneParts(instant, timeZone);
  let h = p.hour % 12;
  if (h === 0) h = 12;
  return h + ':' + pad2(p.minute);
}

/** Saturday 12 September */
export function fmtDayLine(instant, timeZone) {
  return labelFormatter(timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(instant)
  );
}

/** Saturday 12 September 2026 */
export function fmtDayLineFull(instant, timeZone) {
  return labelFormatter(timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant));
}

/** Saturday */
export function fmtWeekday(instant, timeZone) {
  return labelFormatter(timeZone, { weekday: 'long' }).format(new Date(instant));
}

/** Fri 21:05 — version / fetched stamps, rendered in the event's zone. */
export function fmtStamp(iso, timeZone) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const p = zoneParts(t, timeZone);
  const wd = labelFormatter(timeZone, { weekday: 'short' }).format(new Date(t));
  return wd + ' ' + pad2(p.hour) + ':' + pad2(p.minute);
}

/**
 * Ticking countdown. `m:ss` under an hour, `h:mm:ss` under a day, `Nd HHh`
 * beyond — so 59:59 rolls to 1:00:00 and 23:59:59 rolls to 1d 00h.
 */
export function fmtCountdown(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return d + 'd ' + pad2(h) + 'h';
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
  return m + ':' + pad2(s);
}

/** Non-ticking countdown for the day before: `14h 02m`, `2d 05h`. */
export function fmtCoarse(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return d + 'd ' + pad2(h) + 'h';
  return h + 'h ' + pad2(m) + 'm';
}

/** +3:12 since the start. */
export function fmtElapsed(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (h > 0) return '+' + h + ':' + pad2(m) + ':' + pad2(s);
  return '+' + m + ':' + pad2(s);
}

/** −2h 50m / −55m / start */
export function fmtTMinus(mins) {
  if (!mins) return 'start';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h) parts.push(h + 'h');
  if (m || !h) parts.push(m + 'm');
  return '−' + parts.join(' ');
}

/** 35 min / 1 hr 5 min */
export function fmtDur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h) parts.push(h + ' hr');
  if (m) parts.push(m + ' min');
  return parts.length ? parts.join(' ') : '0 min';
}

/* ----------------------------------------------------------------- normalise */
// One shape for every race, whatever it came from (file, localStorage, share
// link). Absent values are explicit nulls so encode -> decode round-trips.

const str = (v) => (v == null ? '' : String(v));
const strOrNull = (v) => (v == null || v === '' ? null : String(v));
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function normaliseRace(input) {
  const r = input || {};
  const e = r.event || {};
  const v = r.venue || {};
  const l = r.links || {};
  return {
    id: r.id ? String(r.id) : slug(e.name || e.regatta || 'race'),
    planVersion: Math.max(1, Math.round(numOr(r.planVersion, 1))),
    updatedAt: strOrNull(r.updatedAt),
    event: {
      name: str(e.name),
      number: numOrNull(e.number),
      regatta: str(e.regatta),
      date: strOrNull(e.date),
      time: strOrNull(e.time),
      timezone: e.timezone ? String(e.timezone) : DEFAULT_TZ,
      format: e.format === 'head' ? 'head' : 'sprint',
      distance: numOrNull(e.distance),
    },
    venue: {
      name: strOrNull(v.name),
      town: strOrNull(v.town),
      mapUrl: strOrNull(v.mapUrl),
      parkingMapUrl: strOrNull(v.parkingMapUrl),
    },
    links: {
      regattaCentral: strOrNull(l.regattaCentral),
      draw: strOrNull(l.draw),
      results: strOrNull(l.results),
    },
    delayMinutes: Math.max(0, Math.round(numOr(r.delayMinutes, 0))),
    milestones: (Array.isArray(r.milestones) ? r.milestones : []).map((m) => ({
      label: str(m && m.label),
      minutes: Math.max(0, Math.round(numOr(m && m.minutes, 0))),
      kind: m && m.kind === 'handsOn' ? 'handsOn' : 'normal',
    })),
    plan: str(r.plan),
    kit: (Array.isArray(r.kit) ? r.kit : []).map(str),
    intel: normaliseIntel(r.intel),
  };
}

export function normaliseIntel(input) {
  const x = input || {};
  const pe = x.precedingEvent;
  return {
    precedingEvent: pe
      ? { number: numOrNull(pe.number), name: str(pe.name), time: strOrNull(pe.time) }
      : null,
    lane: numOrNull(x.lane),
    bow: numOrNull(x.bow),
    startInterval: numOrNull(x.startInterval),
    competitors: (Array.isArray(x.competitors) ? x.competitors : []).map((c) => ({
      club: str(c && c.club),
      crew: strOrNull(c && c.crew),
      lane: numOrNull(c && c.lane),
      bow: numOrNull(c && c.bow),
      ageCategory: strOrNull(c && c.ageCategory),
      isUs: !!(c && c.isUs),
      history: (Array.isArray(c && c.history) ? c.history : []).map((h) => ({
        event: str(h && h.event),
        time: strOrNull(h && h.time),
        adjusted: !!(h && h.adjusted),
        place: numOrNull(h && h.place),
        source: strOrNull(h && h.source),
      })),
    })),
    summary: str(x.summary),
    sources: (Array.isArray(x.sources) ? x.sources : []).map((s) => ({
      url: str(s && s.url),
      fetchedAt: strOrNull(s && s.fetchedAt),
      note: strOrNull(s && s.note),
    })),
    enrichedAt: strOrNull(x.enrichedAt),
  };
}

/* ------------------------------------------------------------------ schedule */

/** Scheduled race start (ignores any delay), or null if no date/time yet. */
export function scheduledStart(race) {
  const e = (race && race.event) || {};
  return parseWallClock(e.date, e.time, zoneOf(race));
}

/** Adjusted race start: scheduled plus `delayMinutes`. */
export function raceStart(race) {
  const t = scheduledStart(race);
  if (t == null) return null;
  return t + Math.max(0, Number(race.delayMinutes) || 0) * MS_MIN;
}

/**
 * Every milestone, worked back from race start: step i begins at
 * `raceStart - sum(minutes[i..end])`. Race start is an implicit final row.
 */
export function buildSchedule(race) {
  const start = raceStart(race);
  if (start == null) return [];
  const list = (race && Array.isArray(race.milestones) ? race.milestones : []).map((m) => ({
    label: str(m && m.label),
    minutes: Math.max(0, Math.round(numOr(m && m.minutes, 0))),
    kind: m && m.kind === 'handsOn' ? 'handsOn' : 'normal',
  }));
  const rows = [];
  let acc = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    acc += list[i].minutes;
    rows.unshift({
      index: i,
      label: list[i].label,
      minutes: list[i].minutes,
      kind: list[i].kind,
      before: acc,
      at: 0,
    });
  }
  rows.push({
    index: list.length,
    label: 'Race start',
    minutes: 0,
    kind: 'raceStart',
    before: 0,
    at: 0,
  });
  for (const r of rows) r.at = start - r.before * MS_MIN;
  return rows;
}

/** Index of the last row that has already begun, or -1 before the day starts. */
export function currentIndex(rows, now) {
  let cur = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i].at <= now) cur = i;
  return cur;
}

export function handsOnRow(rows) {
  return rows.find((r) => r.kind === 'handsOn') || null;
}

/**
 * Which of the four clock states to draw, plus everything each one needs.
 *   unscheduled — no race time published
 *   ahead       — a different day in the event's zone: hours/minutes, no ticking
 *   pre         — race day, hands on still to come: hands on gets the big digits
 *   launched    — hands on done: race start gets the big digits
 *   racing      — under way: the whole block turns teal
 */
export function clockState(race, now) {
  const rows = buildSchedule(race);
  if (!rows.length) return { state: 'unscheduled', rows: [] };
  const tz = zoneOf(race);
  const startRow = rows[rows.length - 1];
  const cur = currentIndex(rows, now);
  const hands = handsOnRow(rows);
  const first = rows[0];

  if (cur >= rows.length - 1) {
    return { state: 'racing', rows, cur, hands, startRow, start: startRow.at, tz };
  }
  const next = rows[cur + 1];
  if (!sameZoneDay(now, first.at, tz) && now < first.at) {
    return { state: 'ahead', rows, cur, hands, next, startRow, start: startRow.at, tz };
  }
  const state = hands && hands.at > now ? 'pre' : 'launched';
  return { state, rows, cur, hands, next, startRow, start: startRow.at, tz };
}

/** The milestone to name in "Arrive by ..." — the arrival step if there is one. */
export function arriveRow(rows) {
  return rows.find((r) => r.kind !== 'raceStart' && /arriv/i.test(r.label)) || rows[0] || null;
}

/* ------------------------------------------------- compact share-link payload */
// Fixed-shape arrays rather than named keys: the whole race, intel included,
// fits in a link you can paste into WhatsApp.

const PAYLOAD_VERSION = 2;
const KIND_CODE = { normal: 0, handsOn: 1 };

export function compactRace(input) {
  const r = normaliseRace(input);
  const e = r.event;
  const v = r.venue;
  const l = r.links;
  return {
    z: PAYLOAD_VERSION,
    i: r.id,
    pv: r.planVersion,
    ua: r.updatedAt,
    e: [e.name, e.number, e.regatta, e.date, e.time, e.timezone, e.format === 'head' ? 1 : 0, e.distance],
    v: [v.name, v.town, v.mapUrl, v.parkingMapUrl],
    l: [l.regattaCentral, l.draw, l.results],
    d: r.delayMinutes,
    m: r.milestones.map((m) => [m.label, m.minutes, KIND_CODE[m.kind] || 0]),
    p: r.plan,
    k: r.kit,
    x: compactIntel(r.intel),
  };
}

function compactIntel(x) {
  const pe = x.precedingEvent;
  return {
    p: pe ? [pe.number, pe.name, pe.time] : null,
    l: x.lane,
    b: x.bow,
    si: x.startInterval,
    c: x.competitors.map((c) => [
      c.club,
      c.crew,
      c.lane,
      c.bow,
      c.ageCategory,
      c.isUs ? 1 : 0,
      c.history.map((h) => [h.event, h.time, h.adjusted ? 1 : 0, h.place, h.source]),
    ]),
    s: x.summary,
    r: x.sources.map((s) => [s.url, s.fetchedAt, s.note]),
    a: x.enrichedAt,
  };
}

export function expandRace(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.e) || !Array.isArray(c.m)) return null;
  const e = c.e;
  const v = Array.isArray(c.v) ? c.v : [];
  const l = Array.isArray(c.l) ? c.l : [];
  return normaliseRace({
    id: c.i,
    planVersion: c.pv,
    updatedAt: c.ua,
    event: {
      name: e[0],
      number: e[1],
      regatta: e[2],
      date: e[3],
      time: e[4],
      timezone: e[5],
      format: e[6] ? 'head' : 'sprint',
      distance: e[7],
    },
    venue: { name: v[0], town: v[1], mapUrl: v[2], parkingMapUrl: v[3] },
    links: { regattaCentral: l[0], draw: l[1], results: l[2] },
    delayMinutes: c.d,
    milestones: c.m.map((m) => ({
      label: m[0],
      minutes: m[1],
      kind: m[2] === 1 ? 'handsOn' : 'normal',
    })),
    plan: c.p,
    kit: c.k,
    intel: expandIntel(c.x),
  });
}

function expandIntel(x) {
  if (!x || typeof x !== 'object') return null;
  const pe = Array.isArray(x.p) ? x.p : null;
  return {
    precedingEvent: pe ? { number: pe[0], name: pe[1], time: pe[2] } : null,
    lane: x.l,
    bow: x.b,
    startInterval: x.si,
    competitors: (Array.isArray(x.c) ? x.c : []).map((c) => ({
      club: c[0],
      crew: c[1],
      lane: c[2],
      bow: c[3],
      ageCategory: c[4],
      isUs: c[5] === 1,
      history: (Array.isArray(c[6]) ? c[6] : []).map((h) => ({
        event: h[0],
        time: h[1],
        adjusted: h[2] === 1,
        place: h[3],
        source: h[4],
      })),
    })),
    summary: x.s,
    sources: (Array.isArray(x.r) ? x.r : []).map((s) => ({
      url: s[0],
      fetchedAt: s[1],
      note: s[2],
    })),
    enrichedAt: x.a,
  };
}

/* --------------------------------------------------------------- base64url */

export function bytesToB64url(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes, transform) {
  const source = new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const reader = source.pipeThrough(transform).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** deflate-raw, or null where the platform can't. */
export async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    return await pipeThrough(bytes, new CompressionStream('deflate-raw'));
  } catch (e) {
    return null;
  }
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    return await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
  } catch (e) {
    return null;
  }
}

/**
 * Race -> share payload. Compressed base64url, or uncompressed with a `u.`
 * marker where CompressionStream is missing ('.' is outside the base64url
 * alphabet, so the marker can never collide with a compressed payload).
 */
export async function encodeRace(race, opts) {
  const bytes = new TextEncoder().encode(JSON.stringify(compactRace(race)));
  if (!(opts && opts.uncompressed)) {
    const deflated = await deflateRaw(bytes);
    if (deflated && deflated.length < bytes.length) return bytesToB64url(deflated);
  }
  return 'u.' + bytesToB64url(bytes);
}

/** Share payload -> race, or null if it isn't a payload we understand. */
export async function decodeRace(payload) {
  const s = String(payload || '').trim();
  if (!s) return null;
  try {
    let bytes;
    if (s.slice(0, 2) === 'u.') {
      bytes = b64urlToBytes(s.slice(2));
    } else {
      const inflated = await inflateRaw(b64urlToBytes(s));
      if (!inflated) return null;
      bytes = inflated;
    }
    const compact = JSON.parse(new TextDecoder().decode(bytes));
    return expandRace(compact);
  } catch (e) {
    return null;
  }
}

export function crewUrl(payload, origin) {
  const base =
    origin ||
    (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  return String(base).replace(/\/(?:r\/)?(?:index\.html)?$/, '/') + 'r/#' + payload;
}

export function importUrl(payload, origin) {
  const base =
    origin ||
    (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  return String(base).replace(/\/(?:r\/)?(?:index\.html)?$/, '/') + '#import=' + payload;
}

/* ------------------------------------------------------------------ calendar */

function icsStamp(instant) {
  const d = new Date(instant);
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    '00Z'
  );
}

function icsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545: fold content lines at 75 octets.
function icsFold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

/** One VEVENT covering the whole race-day schedule. */
export function buildIcs(race, shareUrl) {
  const rows = buildSchedule(race);
  if (!rows.length) return null;
  const tz = zoneOf(race);
  const start = rows[rows.length - 1].at;
  const first = rows[0].at;
  const e = race.event || {};
  const venue = race.venue || {};
  const where = [venue.name, venue.town].filter(Boolean).join(', ');
  const desc =
    rows.map((r) => fmtTime(r.at, tz) + '  ' + r.label).join('\n') +
    (race.plan ? '\n\n' + race.plan : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Race Day//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + (race.id || 'race') + '@raceday',
    'DTSTAMP:' + icsStamp(Date.now()),
    'DTSTART:' + icsStamp(first),
    'DTEND:' + icsStamp(start + 15 * MS_MIN),
    'SUMMARY:' +
      icsEscape(
        [e.name, e.regatta].filter(Boolean).join(' — ') + ' (race ' + fmtTime(start, tz) + ')'
      ),
    'LOCATION:' + icsEscape(where),
    'DESCRIPTION:' + icsEscape(desc),
  ];
  if (shareUrl) lines.push('URL:' + icsEscape(shareUrl));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
