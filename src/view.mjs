// Race Day — rendering only. Both the owner page and the crew page load this;
// nothing here writes a race or reaches the editor.

import {
  buildSchedule,
  clockState,
  currentIndex,
  arriveRow,
  handsOnRow,
  fmtTime,
  fmtTimeShort,
  fmtDayLine,
  fmtWeekday,
  fmtCountdown,
  fmtCoarse,
  fmtElapsed,
  fmtTMinus,
  fmtDur,
  fmtStamp,
  raceStart,
  scheduledStart,
  zoneOf,
} from './core.mjs';

/* ----------------------------------------------------------------- helpers */

export function el(tag, props, kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k === 'checked' || k === 'value' || k === 'disabled') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  append(n, kids);
  return n;
}

export function append(node, kids) {
  if (kids == null || kids === false) return node;
  if (Array.isArray(kids)) {
    for (const k of kids) append(node, k);
    return node;
  }
  node.appendChild(typeof kids === 'string' ? document.createTextNode(kids) : kids);
  return node;
}

/** Static, author-written SVG only. */
function icon(markup, size, opts) {
  const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML =
    '<svg width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="' +
    (opts && opts.stroke ? opts.stroke : 'currentColor') +
    '" stroke-width="' +
    (opts && opts.width ? opts.width : 2) +
    '" stroke-linecap="round" stroke-linejoin="round">' +
    markup +
    '</svg>';
  return span.firstChild;
}

const PIN = '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle>';
const TICK = '<path d="M20 6 9 17l-5-5"></path>';
const LINK =
  '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path>';

export { PIN, TICK, LINK, icon };

function setText(node, value) {
  const s = value == null ? '' : String(value);
  if (node.textContent !== s) node.textContent = s;
}

function show(node, on) {
  if (node.hidden === !on) return;
  node.hidden = !on;
}

/* ---------------------------------------------------------------- identity */

export function identityBlock(race, opts) {
  const o = opts || {};
  const tz = zoneOf(race);
  const e = race.event || {};
  const v = race.venue || {};
  const l = race.links || {};
  const sched = scheduledStart(race);

  let when;
  if (sched != null) when = fmtDayLine(sched, tz) + ' · Race ' + fmtTime(sched, tz);
  else if (e.date) when = e.date + ' · Race time not yet published';
  else when = 'Date not set';

  const sub = [e.regatta, e.number != null ? 'Event #' + e.number : null]
    .filter(Boolean)
    .join(' · ');

  const kids = [
    el('div', { class: 'cap when', text: when }),
    el('h1', { text: e.name || e.regatta || 'Untitled race' }),
  ];
  if (sub) kids.push(el('div', { class: 'regatta', text: sub }));

  const place = [v.name, v.town].filter(Boolean).join(', ');
  if (place || v.mapUrl) {
    const venue = el('div', { class: 'venue' }, [
      icon(PIN, 16, { stroke: 'var(--accent)' }),
      el('span', { text: place || 'Venue' }),
    ]);
    if (v.mapUrl) {
      venue.appendChild(
        el('a', { href: v.mapUrl, target: '_blank', rel: 'noopener', text: 'Map' })
      );
    }
    if (v.parkingMapUrl) {
      venue.appendChild(
        el('a', { href: v.parkingMapUrl, target: '_blank', rel: 'noopener', text: 'Parking' })
      );
    }
    kids.push(venue);
  }

  if (o.mode === 'owner') {
    const links = [];
    if (l.regattaCentral)
      links.push(
        el('a', {
          href: l.regattaCentral,
          target: '_blank',
          rel: 'noopener',
          text: 'Regatta Central',
        })
      );
    if (l.draw)
      links.push(el('a', { href: l.draw, target: '_blank', rel: 'noopener', text: 'Draw' }));
    if (l.results)
      links.push(el('a', { href: l.results, target: '_blank', rel: 'noopener', text: 'Results' }));
    if (links.length) kids.push(el('div', { class: 'owner-links' }, links));
  }

  const stamps = [];
  const stampText =
    'Plan v' + race.planVersion + (race.updatedAt ? ' · ' + fmtStamp(race.updatedAt, tz) : '');
  stamps.push(el('span', { class: 'stamp', text: stampText }));
  if (race.delayMinutes > 0) {
    stamps.push(
      el('span', { class: 'badge-late', text: '+' + race.delayMinutes + ' MIN LATE' })
    );
  }
  kids.push(el('div', { class: 'stamps' }, stamps));

  return el('header', { class: 'identity' }, kids);
}

/* ------------------------------------------------------------------- clock */

/**
 * The clock block. Structure is built once; `update(now)` rewrites only the
 * text that changed, and rebuilds the cells only when the state changes.
 */
export function clockBlock(race, opts) {
  const o = opts || {};
  const tz = zoneOf(race);
  const e = race.event || {};
  const links = race.links || {};

  if (raceStart(race) == null) {
    const box = el('div', { class: 'no-time' }, ['Race time not yet published — ']);
    if (links.regattaCentral) {
      box.appendChild(
        el('a', {
          href: links.regattaCentral,
          target: '_blank',
          rel: 'noopener',
          text: 'check Regatta Central',
        })
      );
    } else {
      box.appendChild(document.createTextNode('check Regatta Central'));
    }
    return { el: box, update() {} };
  }

  const nextCap = el('div', { class: 'cap', text: 'Next' });
  const nextLabel = el('div', { class: 'next-label' });
  const nextAtTime = el('span', { class: 'mono at' });
  const nextAtIn = el('span', { class: 'mono in' });
  const nextAt = el('div', { class: 'next-at' }, [nextAtTime, nextAtIn]);
  const nextNow = el('div', { class: 'next-now' });
  const next = el('div', { class: 'next' }, [nextCap, nextLabel, nextAt, nextNow]);

  const leftCap = el('div', { class: 'cap' });
  const leftBig = el('div', { class: 'mono big' });
  const leftAt = el('div', { class: 'mono at' });
  const left = el('div', { class: 'cell left' }, [leftCap, leftBig, leftAt]);

  const rightCap = el('div', { class: 'cap' });
  const rightMid = el('div', { class: 'mono mid' });
  const rightAt = el('div', { class: 'mono at' });
  const rightChip = el('span', { class: 'chip' }, [
    icon(TICK, 12, { width: 3 }),
    el('span', { class: 'mono' }),
  ]);
  const rightResults = el('a', {
    class: 'results',
    target: '_blank',
    rel: 'noopener',
    text: 'Results ↗',
  });
  const right = el('div', { class: 'cell right' }, [
    rightCap,
    rightMid,
    rightAt,
    rightChip,
    rightResults,
  ]);

  const cells = el('div', { class: 'cells' }, [left, right]);
  const root = el('section', { class: 'clock', 'aria-label': 'Countdown' }, [
    next,
    el('div', { class: 'rule' }),
    cells,
  ]);

  let drawn = '';

  function layout(state, hands) {
    const key = state + (hands ? '|h' : '') + (links.results ? '|r' : '');
    if (drawn === key) return;
    drawn = key;
    const twoUp = state === 'ahead' || state === 'pre';
    root.classList.toggle('is-racing', state === 'racing');
    // The day before, the digits read "14h 02m" — longer, so smaller.
    root.classList.toggle('is-coarse', state === 'ahead');
    show(nextAt, state === 'pre' || state === 'launched');
    show(rightChip, state === 'launched' && !!hands);
    show(rightResults, state === 'racing' && !!links.results);
    show(rightMid, twoUp && !!hands);
    show(rightAt, twoUp && !!hands);
    show(leftAt, state !== 'racing');
    show(
      right,
      state === 'racing' ? !!links.results : !!hands
    );
    right.classList.toggle('is-quiet', state === 'launched');
    if (state === 'racing' && links.results) rightResults.href = links.results;
  }

  function update(now) {
    const s = clockState(race, now);
    layout(s.state, s.hands);

    if (s.state === 'racing') {
      setText(nextCap, 'Racing');
      setText(nextLabel, e.name || e.regatta || 'Race');
      setText(nextNow, 'Started ' + fmtTime(s.start, tz));
      setText(leftCap, 'Elapsed');
      setText(leftBig, fmtElapsed(now - s.start));
      setText(rightCap, '');
      return;
    }

    setText(nextCap, 'Next');

    if (s.state === 'ahead') {
      const arrive = arriveRow(s.rows);
      const first = s.rows[0];
      setText(
        nextLabel,
        'Arrive by ' + fmtTime(arrive.at, tz) + ' ' + fmtWeekday(arrive.at, tz)
      );
      setText(
        nextNow,
        arrive !== first ? first.label + ' ' + fmtTime(first.at, tz) : placeOf(race)
      );
      if (s.hands) {
        setText(leftCap, 'Hands on');
        setText(leftBig, fmtCoarse(s.hands.at - now));
        setText(leftAt, fmtTime(s.hands.at, tz));
        setText(rightCap, 'Race start');
        setText(rightMid, fmtCoarse(s.start - now));
        setText(rightAt, startAtLine(race, s.start, tz, o.mode));
      } else {
        setText(leftCap, 'Race start');
        setText(leftBig, fmtCoarse(s.start - now));
        setText(leftAt, startAtLine(race, s.start, tz, o.mode));
      }
      return;
    }

    // pre / launched: a ticking clock
    setText(nextLabel, s.next.label);
    setText(nextAtTime, fmtTime(s.next.at, tz));
    setText(nextAtIn, 'in ' + fmtCountdown(s.next.at - now));
    setText(nextNow, s.cur >= 0 ? 'Now: ' + s.rows[s.cur].label : '');

    if (s.state === 'pre') {
      setText(leftCap, 'Hands on');
      setText(leftBig, fmtCountdown(s.hands.at - now));
      setText(leftAt, fmtTime(s.hands.at, tz));
      setText(rightCap, 'Race start');
      setText(rightMid, fmtCountdown(s.start - now));
      setText(rightAt, startAtLine(race, s.start, tz, o.mode));
    } else {
      setText(leftCap, 'Race start');
      setText(leftBig, fmtCountdown(s.start - now));
      setText(leftAt, startAtLine(race, s.start, tz, o.mode));
      if (s.hands) {
        setText(rightCap, 'Hands on');
        setText(rightChip.lastChild, fmtTimeShort(s.hands.at, tz));
      }
    }
  }

  return { el: root, update };
}

// Owner mode spells the delay out beside race start; the crew view already
// carries the orange badge up in the identity block.
function startAtLine(race, start, tz, mode) {
  const late = mode === 'owner' && race.delayMinutes > 0;
  return fmtTime(start, tz) + (late ? ' · +' + race.delayMinutes + ' min late' : '');
}

function placeOf(race) {
  const v = race.venue || {};
  return [v.name, v.town].filter(Boolean).join(', ');
}

/* ---------------------------------------------------------------- timeline */

export function timelineBlock(race) {
  const tz = zoneOf(race);
  const rows = buildSchedule(race);
  const root = el('ol', { class: 'tl sec-tl', 'aria-label': 'Schedule' });
  if (!rows.length) return { el: root, update() {} };

  const items = rows.map((r) => {
    const li = el('li', { class: 'tl-row' }, [
      el('span', { class: 'mono t', text: fmtTime(r.at, tz) }),
      el('span', { class: 'mono tminus', text: fmtTMinus(r.before) }),
      el('span', { class: 'what', text: r.label }),
      el('span', { class: 'dur', text: r.kind === 'raceStart' ? '' : fmtDur(r.minutes) }),
    ]);
    if (r.kind === 'handsOn') li.classList.add('is-handson');
    if (r.kind === 'raceStart') li.classList.add('is-race');
    root.appendChild(li);
    return li;
  });

  function update(now) {
    const cur = currentIndex(rows, now);
    for (let i = 0; i < items.length; i++) {
      const past = i < cur || (cur === rows.length - 1 && i === cur);
      items[i].classList.toggle('is-past', past);
      items[i].classList.toggle('is-now', i === cur && cur < rows.length - 1);
    }
  }

  return { el: root, update };
}

/* -------------------------------------------------------------------- plan */

export function planBlock(race) {
  if (!race.plan) return null;
  return el('section', { class: 'sec plan' }, [
    el('div', { class: 'sec-head' }, [el('h2', { text: 'Race plan' })]),
    el('div', { class: 'plan-body', text: race.plan }),
  ]);
}

/* ------------------------------------------------------------------- intel */

function sourceLabel(url) {
  const u = String(url || '');
  if (/regattacentral/i.test(u)) return 'Regatta Central';
  if (/regattamaster|xtabresults/i.test(u)) return 'RegattaMaster';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function raceTimeToSeconds(s) {
  const m = /^(?:(\d+):)?(\d{1,2})(?:[.:](\d{1,2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return (Number(m[1] || 0) * 60 + Number(m[2])) * 1 + (m[3] ? Number('0.' + m[3]) : 0);
}

/** The fastest recorded result for a crew, or the first that has a time. */
function bestHistory(c) {
  let best = null;
  let bestSecs = Infinity;
  for (const h of c.history || []) {
    if (!h.time) continue;
    const secs = raceTimeToSeconds(h.time);
    if (secs == null) {
      if (!best) best = h;
      continue;
    }
    if (secs < bestSecs) {
      bestSecs = secs;
      best = h;
    }
  }
  return best;
}

const ORDINALS = ['', '1st', '2nd', '3rd'];
function ordinal(n) {
  if (n == null) return '';
  if (n < 4) return ORDINALS[n] || '';
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
  const last = n % 10;
  return n + (last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th');
}

export function intelBlock(race) {
  const x = race.intel || {};
  const e = race.event || {};
  const isHead = e.format === 'head';
  const cards = [];

  const pe = x.precedingEvent;
  if (pe && (pe.name || pe.number != null)) {
    const title = (pe.number != null ? '#' + pe.number + ' ' : '') + (pe.name || '');
    const sub = [pe.time ? tidyTime(pe.time) : null, "if it's late, so are we"]
      .filter(Boolean)
      .join(' · ');
    cards.push(
      el('div', { class: 'card' }, [
        el('div', { class: 'cap', text: 'Preceding event' }),
        el('div', { class: 'head-line', text: title.trim() }),
        el('div', { class: 'mono sub', text: sub }),
      ])
    );
  }

  const position = isHead ? x.bow : x.lane;
  if (position != null) {
    const bits = [];
    if (e.distance) bits.push(e.distance + ' m');
    bits.push(isHead ? 'head race' : 'sprint');
    if (isHead && x.startInterval) bits.push(x.startInterval + 's between crews');
    else if (!isHead && x.competitors.length) bits.push(x.competitors.length + ' lanes');
    cards.push(
      el('div', { class: 'card' }, [
        el('div', { class: 'cap', text: isHead ? 'Bow' : 'Lane' }),
        el('div', { class: 'digit', text: String(position) }),
        el('div', { class: 'mono sub', text: bits.join(' · ') }),
      ])
    );
  }

  if (x.competitors.length || x.summary) {
    const card = el('div', { class: 'card wide' }, [
      el('div', { class: 'cap', text: 'Competitors' }),
    ]);
    if (x.summary) card.appendChild(el('div', { class: 'summary', text: x.summary }));

    if (x.competitors.length) {
      const list = el('div', { class: 'comp' });
      const events = new Set();
      const hosts = new Set();
      let anyAdjusted = false;

      for (const c of x.competitors) {
        const pos = isHead ? c.bow : c.lane;
        const best = bestHistory(c);
        if (best) {
          if (best.event) events.add(best.event);
          if (best.source) hosts.add(sourceLabel(best.source));
          if (best.adjusted) anyAdjusted = true;
        }
        const club = el('span', {
          class: 'club',
          text: c.club + (c.isUs ? ' (us)' : ''),
        });
        if (c.crew) club.appendChild(el('small', { text: c.crew }));
        const row = el('div', { class: 'comp-row' + (c.isUs ? ' is-us' : '') }, [
          el('span', {
            class: 'mono pos',
            text: pos != null ? (isHead ? '#' + pos : 'L' + pos) : '',
          }),
          club,
          el('span', { class: 'agecat', text: c.ageCategory || '' }),
          el('span', {
            class: 'mono best',
            text: best
              ? [best.time, ordinal(best.place)].filter(Boolean).join(' · ')
              : '',
          }),
        ]);
        list.appendChild(row);
      }
      card.appendChild(list);

      if (events.size) {
        const note =
          'Times are ' +
          [...events].join(' / ') +
          ' results' +
          (anyAdjusted ? ', adjusted' : '') +
          (hosts.size ? ' · ' + [...hosts].filter(Boolean).join(', ') : '');
        card.appendChild(el('div', { class: 'foot-note', text: note }));
      }
    }
    cards.push(card);
  }

  if (!cards.length) return null;

  const src = (x.sources && x.sources[0]) || null;
  const stampAt = x.enrichedAt || (src && src.fetchedAt);
  const noteBits = [src ? sourceLabel(src.url) : null];
  if (stampAt) noteBits.push('fetched ' + fmtStamp(stampAt, zoneOf(race)));

  return el('section', { class: 'sec intel' }, [
    el('div', { class: 'sec-head' }, [
      el('h2', { text: 'Race intel' }),
      el('div', { class: 'sec-note', text: noteBits.filter(Boolean).join(' · ') }),
    ]),
    el('div', { class: 'cards' }, cards),
  ]);
}

function tidyTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
  if (!m) return String(hhmm);
  const h = Number(m[1]);
  const ap = h >= 12 ? 'pm' : 'am';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ':' + m[2] + ' ' + ap;
}

/* --------------------------------------------------------------------- kit */

const TICK_PREFIX = 'raceday.kit.';

export function readTicks(raceId) {
  try {
    const raw = localStorage.getItem(TICK_PREFIX + raceId);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : [];
  } catch (e) {
    return [];
  }
}

export function writeTicks(raceId, list) {
  try {
    localStorage.setItem(TICK_PREFIX + raceId, JSON.stringify(list));
  } catch (e) {
    /* private mode: ticks just won't persist */
  }
}

export function kitBlock(race) {
  if (!race.kit.length) return null;
  let ticked = readTicks(race.id);
  const count = el('div', { class: 'sec-note' });
  const list = el('ul', { class: 'kit' });

  const refresh = () => {
    count.textContent = ticked.length + ' / ' + race.kit.length + ' packed';
  };

  race.kit.forEach((item, i) => {
    const box = el('input', {
      type: 'checkbox',
      id: 'kit-' + i,
      checked: ticked.indexOf(i) >= 0,
    });
    box.addEventListener('change', () => {
      ticked = ticked.filter((n) => n !== i);
      if (box.checked) ticked.push(i);
      writeTicks(race.id, ticked);
      refresh();
    });
    list.appendChild(
      el('li', { class: 'kit-row' }, [
        el('label', { for: 'kit-' + i }, [box, el('span', { text: item })]),
      ])
    );
  });
  refresh();

  return el('section', { class: 'sec kit' }, [
    el('div', { class: 'sec-head' }, [el('h2', { text: 'Kit' }), count]),
    list,
    el('div', { class: 'kit-note', text: 'Ticks are saved on this device only.' }),
  ]);
}

/* ------------------------------------------------------------------ footer */

export function footerBlock(opts) {
  const o = opts || {};
  const acts = el('div', { class: 'acts' });
  for (const a of o.actions || []) {
    acts.appendChild(
      el('button', { class: 'btn' + (a.style ? ' ' + a.style : ''), type: 'button', dataset: { act: a.act }, text: a.label })
    );
  }
  return el('footer', { class: 'foot' }, [
    el('span', { class: 'by', text: o.note || '' }),
    acts,
  ]);
}

/* --------------------------------------------------------------- wake lock */

/** Keep the screen on while the clock is visible; release when hidden. */
export function installWakeLock() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  let lock = null;
  const release = () => {
    if (lock) {
      lock.release().catch(() => {});
      lock = null;
    }
  };
  const request = () => {
    if (lock || document.visibilityState !== 'visible') return;
    navigator.wakeLock
      .request('screen')
      .then((l) => {
        lock = l;
        l.addEventListener('release', () => {
          lock = null;
        });
      })
      .catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') request();
    else release();
  });
  request();
}

/* ------------------------------------------------------------------- toast */

let toastEl = null;
let toastTimer = 0;

export function toast(message) {
  if (!toastEl) {
    toastEl = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* -------------------------------------------------------------------- misc */

export function downloadFile(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

/** One ticker for the whole page, aligned to the second. */
export function startTicker(parts) {
  const run = () => {
    const now = Date.now();
    for (const p of parts) if (p && p.update) p.update(now);
  };
  run();
  const id = setInterval(run, 1000);
  return () => clearInterval(id);
}

export { handsOnRow };
