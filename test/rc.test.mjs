// Parsers for Regatta Central, against responses captured from the real site
// on 11 Sep 2026 (test/fixtures/rc). When RC changes its markup these are the
// tests that should fail first.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  decodeEntities,
  elementByAttr,
  findEvent,
  inferFormat,
  isChallenge,
  looseMatch,
  mapUrl,
  normaliseClub,
  parseCompetitors,
  parseEvents,
  parseEventUrl,
  parseOverview,
  parsePriorRegattaIds,
  parseResultsList,
  parseXtabResults,
  precedingEvent,
  stripTags,
  to24h,
  toIsoDate,
  urls,
} from '../scripts/rc.mjs';

const fixture = (name) => readFile(new URL('./fixtures/rc/' + name, import.meta.url), 'utf8');
const json = async (name) => JSON.parse(await fixture(name));

/* ---------------------------------------------------------------- plumbing */

test('event links yield the regatta and event ids', () => {
  assert.deepEqual(
    parseEventUrl('https://www.regattacentral.com/v3/regatta/10552/event/14/competitors'),
    { regattaId: '10552', eventId: '14' }
  );
  assert.deepEqual(parseEventUrl('https://www.regattacentral.com/v3/regatta/10552'), {
    regattaId: '10552',
    eventId: null,
  });
  assert.deepEqual(parseEventUrl('https://www.regattacentral.com/regatta?job_id=9916'), {
    regattaId: '9916',
    eventId: null,
  });
  assert.equal(parseEventUrl('https://example.com/nope'), null);
});

test('url builders', () => {
  assert.equal(
    urls.competitorsData('10552', '14'),
    'https://www.regattacentral.com/v3/regatta/10552/event/14/competitors/data'
  );
  assert.equal(
    urls.eventsApi('10552'),
    'https://www.regattacentral.com/v3/api/regatta/10552/events'
  );
});

test('html helpers', () => {
  assert.equal(decodeEntities('Sanctioned by RCA &amp; ON &#39;26&nbsp;'), "Sanctioned by RCA & ON '26 ");
  assert.equal(stripTags('<p>a <b>b</b><!-- x --> c</p>'), 'a b c');
  // Nested tags of the same name must not end the match early.
  assert.equal(
    stripTags(elementByAttr('<div class="a"><div>one</div>two</div><div>after</div>', 'class', 'a')),
    'one two'
  );
  assert.equal(elementByAttr('<div class="b">x</div>', 'class', 'a'), null);
});

test('dates and times', () => {
  assert.equal(toIsoDate('Sept 12, 2026'), '2026-09-12');
  assert.equal(toIsoDate('September 12, 2026'), '2026-09-12');
  assert.equal(toIsoDate('Oct 3, 2026'), '2026-10-03');
  assert.equal(toIsoDate('2026-09-12'), '2026-09-12');
  assert.equal(toIsoDate('sometime'), null);
  assert.equal(to24h('11:50 AM'), '11:50');
  assert.equal(to24h('2:00 PM'), '14:00');
  assert.equal(to24h('12:05 AM'), '00:05');
  assert.equal(to24h('12:05 PM'), '12:05');
  assert.equal(to24h(''), null);
});

test('the Cloudflare challenge is recognised, not parsed', () => {
  assert.ok(isChallenge('<!DOCTYPE html><html><head><title>Just a moment...</title>'));
  assert.ok(!isChallenge('<html><title>Muskoka Fall Classic | Overview - RegattaCentral</title>'));
});

/* ------------------------------------------------------- the real captures */

test('the regatta header gives name, venue, town, date, host and event type', async () => {
  assert.deepEqual(parseOverview(await fixture('overview.html')), {
    regatta: 'Muskoka Fall Classic',
    venueName: 'Gull Lake Rotary Park',
    venueTown: 'Gravenhurst, ON',
    venueId: '435',
    date: '2026-09-12',
    host: 'Georgian Bay Rowing Club',
    eventType: 'Head',
  });
});

test('a header field that moves costs one field, not the run', () => {
  const broken = '<html><head><title>Muskoka Fall Classic | Overview - RegattaCentral</title></head><body>nothing else</body></html>';
  const out = parseOverview(broken);
  assert.equal(out.regatta, 'Muskoka Fall Classic');
  assert.equal(out.venueName, null);
  assert.equal(out.date, null);
  // …and junk in does not throw.
  assert.equal(parseOverview(null).regatta, null);
  assert.equal(parseOverview('<<<').venueName, null);
});

test('the draw resolves our event and the one before it', async () => {
  const events = parseEvents(await json('events.json'));
  assert.equal(events.length, 51);

  const ours = findEvent(events, '14');
  assert.equal(ours.name, 'Mens Masters (21+) 4+');
  assert.equal(ours.number, '24'); // RC's internal eventId 14 is event #24 on the draw
  assert.equal(ours.raceTime, '11:50');
  assert.equal(ours.date, '2026-09-12');
  assert.equal(ours.boatCount, 3);

  const before = precedingEvent(events, ours);
  assert.equal(before.number, '23');
  assert.equal(before.name, 'Mens U19 4+');
  assert.equal(before.raceTime, '11:50');

  // Order is the running order, not the id order.
  assert.deepEqual(events.slice(0, 3).map((e) => e.number), ['1', '2', '3']);
  assert.equal(findEvent(events, '999'), null);
  assert.equal(precedingEvent(events, events[0]), null);
  assert.deepEqual(parseEvents(null), []);
});

test('the entry list keeps clubs and treats an undrawn bow as absent', async () => {
  const entries = parseCompetitors(await json('competitors.json'));
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.club),
    ['Argonaut Rowing Club', 'Argonaut Rowing Club', 'South Niagara Rowing Club']
  );
  assert.deepEqual(entries.map((e) => e.boatLabel), ['Holmes, J.', 'Dillon, H.', 'Madronich, J.']);
  assert.deepEqual(entries.map((e) => e.avgAge), [53, 50, 59]);
  // RC prints "0" until bow numbers are drawn — that is not bow zero.
  assert.deepEqual(entries.map((e) => e.bow), [null, null, null]);
  assert.equal(entries.every((e) => !e.scratched), true);
  assert.equal(entries[1].lineup.length, 5);
  assert.equal(entries[1].lineup[1], '4: Henry Dillon');
  assert.deepEqual(parseCompetitors(undefined), []);
});

test('a drawn bow comes through as a number', () => {
  const [e] = parseCompetitors([{ organization: 'Argonaut', bow: '4', status: 'OK' }]);
  assert.equal(e.bow, 4);
  const [s] = parseCompetitors([{ organization: 'Argonaut', bow: '7', status: 'SCRATCHED' }]);
  assert.equal(s.scratched, true);
});

test('format comes from RC when RC states it, else from the spec rules', () => {
  assert.equal(inferFormat({ eventType: 'Head' }), 'head');
  assert.equal(inferFormat({ eventType: 'Sprint', regatta: 'Head of the Trent' }), 'sprint');
  assert.equal(inferFormat({ regatta: 'Head of the Charles' }), 'head');
  assert.equal(inferFormat({ eventName: 'Mens Masters 4+', distance: 5000 }), 'head');
  assert.equal(inferFormat({ regatta: 'Canadian Henley', distance: 1000 }), 'sprint');
  assert.equal(inferFormat({}), 'sprint');
});

test('results pages report nothing posted, and hand over any lead', async () => {
  const now = parseResultsList(await fixture('results-list.html'));
  assert.equal(now.posted, false);
  assert.match(now.note, /None posted/);

  const last = parseResultsList(await fixture('results-list-9916.html'));
  assert.equal(last.posted, false);
  assert.ok(
    last.links.some((l) => l.includes('crewtimer.com/regatta/r14907')),
    'the 2025 edition points at CrewTimer'
  );
});

test('earlier editions are found on the history page, newest first', async () => {
  const ids = parsePriorRegattaIds(await fixture('history.html'), '10552');
  assert.deepEqual(ids, ['9916', '9048', '8556', '7803', '7263', '6601']);
  assert.deepEqual(parsePriorRegattaIds('', '10552'), []);
});

/* -------------------------------------------------- prior-result matching */

test('cross-tab results are read strictly and matched on a normalised club', () => {
  const html = `
    <table><tr><th>Mens Masters (21+) 4+</th></tr>
      <tr><td>1</td><td>Western Reserve Rowing Association</td><td>3:37.81</td></tr>
      <tr><td>2</td><td>Argonaut Rowing Club</td><td>3:41.02</td></tr>
      <tr><td></td><td>DNS</td><td>—</td></tr>
    </table>
    <table><tr><th>Womens Masters 2x</th></tr>
      <tr><td>1</td><td>Argonaut Rowing Club</td><td>4:01.5</td></tr>
    </table>`;
  const rows = parseXtabResults(html, 'Mens Masters (21+) 4+');
  assert.deepEqual(rows, [
    { place: 1, club: 'Western Reserve Rowing Association', time: '3:37.81' },
    { place: 2, club: 'Argonaut Rowing Club', time: '3:41.02' },
  ]);
  // A different event's table is not borrowed.
  assert.equal(rows.some((r) => r.time === '4:01.5'), false);
});

test('club names match across sources', () => {
  assert.equal(normaliseClub('Argonaut Rowing Club'), 'argonaut');
  assert.ok(looseMatch('Argonaut Rowing Club', 'Argonaut'));
  assert.ok(looseMatch('South Niagara Rowing Club', 'South Niagara'));
  assert.ok(!looseMatch('Argonaut Rowing Club', 'Western Reserve'));
  assert.ok(!looseMatch('', 'Argonaut'));
});

test('the map url is a search, not invented coordinates', () => {
  assert.equal(
    mapUrl('Gull Lake Rotary Park', 'Gravenhurst, ON'),
    'https://www.google.com/maps/search/?api=1&query=Gull%20Lake%20Rotary%20Park%2C%20Gravenhurst%2C%20ON'
  );
  assert.equal(mapUrl(null, null), null);
});

/* ------------------------------------------------------- the enriched race */

test('the committed Muskoka race matches what RC published', async () => {
  const race = JSON.parse(
    await readFile(new URL('../races/muskoka-fall-classic-2026-e24.json', import.meta.url), 'utf8')
  );
  assert.equal(race.event.name, 'Mens Masters (21+) 4+');
  assert.equal(race.event.number, 24);
  assert.equal(race.event.regatta, 'Muskoka Fall Classic');
  assert.equal(race.event.date, '2026-09-12');
  assert.equal(race.event.time, '11:50');
  assert.equal(race.event.format, 'head', 'RC states Event Type: Head');
  assert.equal(race.venue.name, 'Gull Lake Rotary Park');
  assert.equal(race.venue.town, 'Gravenhurst, ON');
  assert.ok(race.venue.mapUrl.startsWith('https://www.google.com/maps/search/'));
  // Not published at enrichment time, so absent rather than guessed.
  assert.equal(race.event.distance, null);
  assert.equal(race.links.results, null);
  assert.equal(race.intel.bow, null);
  assert.deepEqual(race.intel.precedingEvent, { number: 23, name: 'Mens U19 4+', time: '11:50' });
  assert.equal(race.intel.competitors.length, 3);
  assert.equal(race.intel.competitors.filter((c) => c.isUs).length, 1);
  assert.equal(race.intel.competitors.find((c) => c.isUs).crew, 'Dillon, H. · avg 50');
  assert.ok(race.intel.competitors.every((c) => c.history.length === 0), 'no prior times exist');
  // Owner-authored fields survived the merge.
  assert.equal(race.milestones.length, 7);
  assert.equal(race.kit.length, 11);
  assert.match(race.plan, /^FOCUS:/);
});
