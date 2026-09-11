// Run with `node --test`. Deliberately pretend to be a UTC device: every race
// time is wall-clock in the event's own zone, so nothing here may depend on
// the machine's.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildSchedule,
  clockState,
  arriveRow,
  buildIcs,
  compactRace,
  decodeRace,
  encodeRace,
  fmtCoarse,
  fmtCountdown,
  fmtDayLine,
  fmtDur,
  fmtElapsed,
  fmtStamp,
  fmtTime,
  fmtTMinus,
  normaliseRace,
  parseWallClock,
  raceStart,
  scheduledStart,
  wallToInstant,
  MS_MIN,
} from '../src/core.mjs';

const TZ = 'America/Toronto';

const muskoka = normaliseRace(
  JSON.parse(
    await readFile(new URL('../races/muskoka-fall-classic-2026-e24.json', import.meta.url), 'utf8')
  )
);

/** A wall-clock instant on race day in Toronto. */
const raceDayAt = (h, m, s = 0) => wallToInstant(2026, 9, 12, h, m, TZ) + s * 1000;

const clockTimes = (race) => buildSchedule(race).map((r) => fmtTime(r.at, TZ));

/* ------------------------------------------------------- schedule maths */

test('milestone times match the spreadsheet worked back from 11:50', () => {
  assert.deepEqual(clockTimes(muskoka), [
    '9:00 am', // last significant food
    '9:35 am', // arrive, unload, rig
    '10:05 am', // change, pee, hydrate
    '10:25 am', // on-land stretch
    '10:55 am', // hands on
    '11:00 am', // launch
    '11:45 am', // starting area
    '11:50 am', // race start
  ]);
});

test('a milestone starts at race start minus the sum of it and everything after', () => {
  const rows = buildSchedule(muskoka);
  assert.deepEqual(
    rows.map((r) => r.before),
    [170, 135, 105, 85, 55, 50, 5, 0]
  );
  assert.equal(rows[4].kind, 'handsOn');
  assert.equal(rows[rows.length - 1].kind, 'raceStart');
  assert.equal(rows[rows.length - 1].at, raceStart(muskoka));
});

test('T-minus and duration labels', () => {
  assert.equal(fmtTMinus(170), '−2h 50m');
  assert.equal(fmtTMinus(105), '−1h 45m');
  assert.equal(fmtTMinus(55), '−55m');
  assert.equal(fmtTMinus(60), '−1h');
  assert.equal(fmtTMinus(0), 'start');
  assert.equal(fmtDur(35), '35 min');
  assert.equal(fmtDur(60), '1 hr');
  assert.equal(fmtDur(65), '1 hr 5 min');
});

/* -------------------------------------------------------------- delays */

test('a delay shifts every row but not the scheduled time', () => {
  const late = normaliseRace({ ...muskoka, delayMinutes: 10 });
  assert.deepEqual(clockTimes(late), [
    '9:10 am',
    '9:45 am',
    '10:15 am',
    '10:35 am',
    '11:05 am',
    '11:10 am',
    '11:55 am',
    '12:00 pm',
  ]);
  // The identity line keeps the scheduled time; only the clock moves.
  assert.equal(fmtTime(scheduledStart(late), TZ), '11:50 am');
  assert.equal(fmtTime(raceStart(late), TZ), '12:00 pm');
  assert.equal(raceStart(late) - raceStart(muskoka), 10 * MS_MIN);
});

/* --------------------------------------------------- countdown formats */

test('countdown rolls over at the hour and the day', () => {
  assert.equal(fmtCountdown(0), '0:00');
  assert.equal(fmtCountdown(9 * 60000 + 42000), '9:42');
  assert.equal(fmtCountdown(59 * 60000 + 59000), '59:59');
  assert.equal(fmtCountdown(60 * 60000), '1:00:00');
  assert.equal(fmtCountdown(3600000 + 4 * 60000 + 42000), '1:04:42');
  assert.equal(fmtCountdown(86399000), '23:59:59');
  assert.equal(fmtCountdown(86400000), '1d 00h');
  assert.equal(fmtCountdown(86400000 + 3600000), '1d 01h');
  assert.equal(fmtCountdown(-5000), '0:00');
});

test('coarse and elapsed formats', () => {
  assert.equal(fmtCoarse(14 * 3600000 + 2 * 60000 + 30000), '14h 02m');
  assert.equal(fmtCoarse(86400000 + 5 * 3600000), '1d 05h');
  assert.equal(fmtElapsed(3 * 60000 + 12000), '+3:12');
  assert.equal(fmtElapsed(3600000 + 2 * 60000 + 3000), '+1:02:03');
});

/* ------------------------------------------------------------ timezone */

test('a Toronto wall-clock time resolves to the right instant on a UTC device', () => {
  const start = scheduledStart(muskoka);
  assert.equal(start, Date.parse('2026-09-12T11:50:00-04:00'));
  assert.equal(fmtTime(start, TZ), '11:50 am');
  assert.equal(fmtDayLine(start, TZ), 'Saturday 12 September');
  // …and the same instant read as UTC really is 15:50, i.e. the device zone
  // is not leaking into the render.
  assert.equal(new Date(start).toISOString(), '2026-09-12T15:50:00.000Z');
});

test('wall-clock parsing handles both sides of a DST change', () => {
  // Toronto is UTC-4 in September, UTC-5 in December.
  assert.equal(
    parseWallClock('2026-09-12', '11:50', TZ),
    Date.parse('2026-09-12T11:50:00-04:00')
  );
  assert.equal(
    parseWallClock('2026-12-12', '11:50', TZ),
    Date.parse('2026-12-12T11:50:00-05:00')
  );
  assert.equal(parseWallClock('', '11:50', TZ), null);
  assert.equal(parseWallClock('2026-09-12', '', TZ), null);
  assert.equal(parseWallClock('2026-09-12', '25:00', TZ), null);
});

test('stamps render in the event zone', () => {
  assert.equal(fmtStamp('2026-09-11T21:05:00-04:00', TZ), 'Fri 21:05');
});

/* --------------------------------------------------------- clock state */

test('the clock walks through its four states', () => {
  const late = normaliseRace({ ...muskoka, delayMinutes: 10 });

  // The evening before: a different day in the event's zone, so no ticking.
  const friday = wallToInstant(2026, 9, 11, 21, 3, TZ);
  const ahead = clockState(late, friday);
  assert.equal(ahead.state, 'ahead');
  assert.equal(arriveRow(ahead.rows).label, 'Arrive, unload, rig, check boat');
  assert.equal(fmtCoarse(ahead.hands.at - friday), '14h 02m');
  assert.equal(fmtCoarse(ahead.start - friday), '14h 57m');

  // 10:55 on the day: on land, hands on next — hands on has the big digits.
  const onLand = raceDayAt(10, 55, 18);
  const pre = clockState(late, onLand);
  assert.equal(pre.state, 'pre');
  assert.equal(pre.next.kind, 'handsOn');
  assert.equal(pre.rows[pre.cur].label, 'On-land stretch and warm-up');
  assert.equal(fmtCountdown(pre.hands.at - onLand), '9:42');
  assert.equal(fmtCountdown(pre.start - onLand), '1:04:42');

  // 11:30: on the water, hands on done — race start takes over.
  const onWater = raceDayAt(11, 30, 2);
  const launched = clockState(late, onWater);
  assert.equal(launched.state, 'launched');
  assert.equal(launched.next.label, 'Starting area — ready to be called');
  assert.equal(fmtCountdown(launched.next.at - onWater), '24:58');
  assert.equal(fmtCountdown(launched.start - onWater), '29:58');
  assert.equal(fmtTime(launched.hands.at, TZ), '11:05 am');

  // After the start.
  const racing = clockState(late, raceDayAt(12, 3, 12));
  assert.equal(racing.state, 'racing');
  assert.equal(fmtElapsed(raceDayAt(12, 3, 12) - racing.start), '+3:12');
});

test('with no race time there is nothing to count down to', () => {
  const tbc = normaliseRace({ ...muskoka, event: { ...muskoka.event, time: null } });
  assert.equal(raceStart(tbc), null);
  assert.deepEqual(buildSchedule(tbc), []);
  assert.equal(clockState(tbc, Date.now()).state, 'unscheduled');
});

test('with no hands-on milestone, race start gets the big digits', () => {
  const flat = normaliseRace({
    ...muskoka,
    milestones: muskoka.milestones.map((m) => ({ ...m, kind: 'normal' })),
  });
  const s = clockState(flat, raceDayAt(10, 55));
  assert.equal(s.hands, null);
  assert.equal(s.state, 'launched');
});

/* ------------------------------------------------- share-link encoding */

test('encode/decode round-trips a race exactly', async () => {
  const payload = await encodeRace(muskoka);
  const back = await decodeRace(payload);
  assert.deepEqual(back, muskoka);
});

test('a full race with intel still fits in a pasteable link', async () => {
  const rich = normaliseRace({
    ...muskoka,
    planVersion: 3,
    delayMinutes: 10,
    intel: {
      precedingEvent: { number: 23, name: 'Womens Masters 2x', time: '11:44' },
      lane: 4,
      competitors: [
        ['Western Reserve', 1, 'D', '3:37.81', 1],
        ['London Western', 2, 'E', '3:38.70', 2],
        ['Endeavor Racing', 3, 'E', '3:50.94', 4],
        ['Argonaut', 4, 'D', '3:53.712', 4],
        ['PNRA / Mercer', 5, 'D', '3:58.14', 5],
        ['Wyandotte', 6, 'E', '3:58.30', 6],
      ].map(([club, lane, ageCategory, time, place]) => ({
        club,
        lane,
        ageCategory,
        isUs: club === 'Argonaut',
        history: [
          {
            event: 'Muskoka Fall Classic 2025',
            time,
            adjusted: true,
            place,
            source: 'https://www.regattacentral.com/regatta/results/?job_id=9876',
          },
        ],
      })),
      summary:
        'Six crews. Western Reserve won this event last year in 3:37.8 adjusted; we were 4th in 3:53.7. London Western and Wyandotte race as E crews and carry a bigger handicap.',
      sources: [
        {
          url: 'https://www.regattacentral.com/v3/regatta/10552/event/14/competitors',
          fetchedAt: '2026-09-11T20:40:00-04:00',
        },
      ],
      enrichedAt: '2026-09-11T20:40:00-04:00',
    },
  });
  const payload = await encodeRace(rich);
  assert.deepEqual(await decodeRace(payload), rich);
  assert.ok(
    payload.length < 1500,
    'payload should stay under 1500 chars, got ' + payload.length
  );
});

test('the uncompressed fallback round-trips too', async () => {
  const payload = await encodeRace(muskoka, { uncompressed: true });
  assert.equal(payload.slice(0, 2), 'u.');
  assert.deepEqual(await decodeRace(payload), muskoka);
  // …and it is decodable without any compression support at all.
  const json = Buffer.from(
    payload.slice(2).replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
  assert.equal(JSON.parse(json).i, muskoka.id);
});

test('junk payloads decode to null rather than throwing', async () => {
  for (const bad of ['', 'not-a-payload', 'u.####', 'u.' + btoa('{"nope":1}')]) {
    assert.equal(await decodeRace(bad), null);
  }
});

test('the compact form keeps every owner-authored field', () => {
  const c = compactRace(muskoka);
  assert.equal(c.m.length, muskoka.milestones.length);
  assert.equal(c.k.length, muskoka.kit.length);
  assert.equal(c.e[0], 'Mens Masters (21+) 4+');
  assert.equal(c.e[1], 24);
  assert.ok(c.x, 'intel travels in the payload so crew see it');
});

/* ------------------------------------------------------------ calendar */

test('the calendar export covers the whole day and carries the timeline', () => {
  const ics = buildIcs(muskoka, 'https://example.test/r/#abc');
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20260912T130000Z/); // 9:00 am Toronto
  assert.match(ics, /DTEND:20260912T160500Z/); // race start + 15 min
  assert.match(ics, /SUMMARY:Mens Masters \(21\+\) 4\+ — Muskoka Fall Classic \(race 11:50 am\)/);
  assert.match(ics, /LOCATION:Gull Lake Rotary Park\\, Gravenhurst\\, ON/);
  assert.match(ics, /URL:https:\/\/example.test\/r\/#abc/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines are folded');
});
