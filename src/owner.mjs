// Owner view: the race list, the editor, the share links. Only `/` loads this
// file — the crew page ships core.mjs + view.mjs and nothing else.

import {
  buildIcs,
  buildSchedule,
  crewUrl,
  decodeRace,
  encodeRace,
  fmtTime,
  fmtTMinus,
  normaliseRace,
  scheduledStart,
  slug,
  zoneOf,
} from './core.mjs';

import {
  clockBlock,
  copyText,
  downloadFile,
  el,
  identityBlock,
  installWakeLock,
  intelBlock,
  kitBlock,
  planBlock,
  startTicker,
  timelineBlock,
  toast,
} from './view.mjs';

const LS_KEY = 'raceday.state.v2';
const app = document.getElementById('app');

const ZONES = [
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Halifax',
  'America/Winnipeg',
  'America/Vancouver',
  'Europe/London',
];

// Henry's standard race day, used when a race is set up by hand.
const TEMPLATE = {
  milestones: [
    { label: 'Last significant food', minutes: 35, kind: 'normal' },
    { label: 'Arrive, unload, rig, check boat', minutes: 30, kind: 'normal' },
    { label: 'Change, pee, hydrate', minutes: 20, kind: 'normal' },
    { label: 'On-land stretch and warm-up', minutes: 30, kind: 'normal' },
    { label: 'Hands on — walk to control', minutes: 5, kind: 'handsOn' },
    { label: 'Launch — on-water warm-up and practice', minutes: 45, kind: 'normal' },
    { label: 'Starting area — ready to be called', minutes: 5, kind: 'normal' },
  ],
  kit: [
    'Photo ID (original — no copies)',
    'Singlet and navy shorts',
    'Water bottle',
    'Sunglasses, sunscreen, hat',
    'Wrenches',
    'Lunch and snacks',
    'Portable chair',
    'Change of clothes',
    'Towel',
  ],
};

/* ------------------------------------------------------------------- state */

function readState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.races)) return { races: o.races.map(normaliseRace) };
    }
  } catch (e) {
    /* fall through to a fresh state */
  }
  return { races: [] };
}

function writeState(next) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    toast('This browser would not save the race');
    return false;
  }
}

let state = readState();
let editing = null; // race id being edited, or 'new'
let notice = null; // { title, lines:[], command, accept:bool }
let stopTicker = null;

const byDate = (a, b) =>
  (a.event.date || '9999').localeCompare(b.event.date || '9999') ||
  (a.event.time || '').localeCompare(b.event.time || '');

function sortedRaces() {
  return state.races.slice().sort(byDate);
}

function findRace(id) {
  return state.races.find((r) => r.id === id) || null;
}

function uniqueId(base) {
  let id = base;
  let n = 2;
  while (findRace(id)) id = base + '-' + n++;
  return id;
}

/** The race the hash points at, else the next one still to come. */
function selectedRace() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  const direct = findRace(hash);
  if (direct) return direct;
  const now = Date.now();
  const upcoming = sortedRaces().filter((r) => {
    const t = scheduledStart(r);
    return t != null && t + 3 * 3600000 > now;
  });
  return upcoming[0] || sortedRaces().pop() || null;
}

function persist(races, message) {
  state = { races };
  if (writeState(state) && message) toast(message);
  render();
}

/* -------------------------------------------------------------------- chrome */

function bar(current) {
  const pills = el('div', { class: 'pills' });
  for (const r of sortedRaces()) {
    pills.appendChild(
      el('a', {
        class: 'pill',
        href: '#' + encodeURIComponent(r.id),
        'aria-current': current && r.id === current.id ? 'true' : null,
        text: [r.event.name || r.id, r.event.regatta].filter(Boolean).join(' · '),
      })
    );
  }
  pills.appendChild(
    el('button', {
      class: 'pill add',
      type: 'button',
      dataset: { act: 'new' },
      text: '+ New race',
    })
  );
  return el('div', { class: 'bar' }, [
    el('div', { class: 'brand disp' }, ['Race Day', el('span', { text: 'My races' })]),
    pills,
  ]);
}

function newRaceRow() {
  return el('form', { class: 'newrace', id: 'newrace' }, [
    el('div', { class: 'cap', text: 'New race' }),
    el('input', {
      type: 'url',
      name: 'rc',
      id: 'rc-url',
      placeholder: 'Paste a Regatta Central event link — everything else is looked up',
      'aria-label': 'Regatta Central event link',
    }),
    el('button', { class: 'btn primary', type: 'submit', text: 'Build race' }),
  ]);
}

function noticeBlock() {
  if (!notice) return null;
  const box = el('div', { class: 'callout' }, [
    el('p', {}, [el('strong', { text: notice.title })]),
  ]);
  for (const line of notice.lines || []) box.appendChild(el('p', { text: line }));
  if (notice.command) {
    box.appendChild(el('code', { class: 'cmd', text: notice.command }));
    box.appendChild(
      el('button', {
        class: 'btn small',
        type: 'button',
        dataset: { act: 'copy-cmd' },
        text: 'Copy command',
      })
    );
  }
  if (notice.accept) {
    box.appendChild(
      el('form', { class: 'newrace', id: 'importform', style: 'margin:12px 0 0' }, [
        el('div', { class: 'cap', text: 'Import link' }),
        el('input', {
          type: 'text',
          name: 'payload',
          placeholder: 'Paste the /#import=… link the script printed',
          'aria-label': 'Import link',
        }),
        el('button', { class: 'btn primary', type: 'submit', text: 'Add race' }),
      ])
    );
  }
  if (notice.manual) {
    box.appendChild(
      el('button', {
        class: 'btn small',
        type: 'button',
        dataset: { act: 'manual', url: notice.manual },
        text: 'Or set it up by hand',
      })
    );
  }
  return box;
}

/* -------------------------------------------------------------------- editor */

function field(label, name, value, opts) {
  const o = opts || {};
  const input = el(o.tag || 'input', {
    id: 'f-' + name,
    name,
    type: o.tag ? null : o.type || 'text',
    value: o.tag ? null : value == null ? '' : value,
    placeholder: o.placeholder,
    min: o.min,
    step: o.step,
    list: o.list,
    inputmode: o.inputmode,
  });
  if (o.tag === 'textarea') input.value = value == null ? '' : value;
  return el('div', { class: 'field' + (o.full ? ' full' : '') }, [
    el('label', { for: 'f-' + name, text: label }),
    input,
  ]);
}

function selectField(label, name, value, options) {
  const sel = el('select', { id: 'f-' + name, name });
  for (const [v, text] of options) {
    sel.appendChild(el('option', { value: v, text, selected: v === value || null }));
  }
  return el('div', { class: 'field' }, [
    el('label', { for: 'f-' + name, text: label }),
    sel,
  ]);
}

function milestoneRow(m, i) {
  return el('tr', { dataset: { ms: String(i) } }, [
    el('td', {}, [
      el('input', {
        type: 'text',
        name: 'ms-label',
        value: m.label,
        'aria-label': 'Step ' + (i + 1) + ' label',
      }),
    ]),
    el('td', {}, [
      el('input', {
        class: 'n',
        type: 'number',
        name: 'ms-minutes',
        min: '0',
        step: '1',
        value: String(m.minutes),
        'aria-label': 'Step ' + (i + 1) + ' duration in minutes',
      }),
    ]),
    el('td', { class: 'hands' }, [
      el('input', {
        type: 'radio',
        name: 'hands',
        value: String(i),
        checked: m.kind === 'handsOn' || null,
        'aria-label': 'Step ' + (i + 1) + ' is hands on',
      }),
    ]),
    el('td', { class: 'mono at' }),
    el('td', { class: 'ctl' }, [
      el('button', { type: 'button', dataset: { act: 'ms-up' }, title: 'Move up', text: '↑' }),
      el('button', { type: 'button', dataset: { act: 'ms-down' }, title: 'Move down', text: '↓' }),
      el('button', { type: 'button', dataset: { act: 'ms-del' }, title: 'Remove', text: '✕' }),
    ]),
  ]);
}

function editorBlock(race) {
  const isNew = !race;
  const r =
    race ||
    normaliseRace({
      event: { timezone: ZONES[0] },
      milestones: TEMPLATE.milestones,
      kit: TEMPLATE.kit,
      links: { regattaCentral: editing && editing.rcUrl },
    });

  const zoneList = el('datalist', { id: 'zones' });
  for (const z of ZONES) zoneList.appendChild(el('option', { value: z }));

  const body = el('tbody');
  r.milestones.forEach((m, i) => body.appendChild(milestoneRow(m, i)));
  body.appendChild(
    el('tr', { class: 'fixed' }, [
      el('td', { text: 'Race start' }),
      el('td', {}),
      el('td', {}),
      el('td', { class: 'mono at', id: 'ms-race' }),
      el('td', {}),
    ])
  );

  const table = el('table', { class: 'ms', id: 'mstable' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Step' }),
        el('th', { text: 'Minutes' }),
        el('th', {}, [
          'Hands on ',
          el('button', {
            class: 'btn small',
            type: 'button',
            dataset: { act: 'hands-clear' },
            text: 'none',
          }),
        ]),
        el('th', { text: 'Starts' }),
        el('th', {}),
      ]),
    ]),
    body,
  ]);

  const form = el(
    'form',
    { class: 'editor', id: 'edform', dataset: { id: isNew ? '' : r.id } },
    [
      el('h2', { text: isNew ? 'New race' : 'Edit race' }),
      el('div', { class: 'grid' }, [
        field('Event name', 'name', r.event.name, {
          full: true,
          placeholder: 'Mens Masters (21+) 4+',
        }),
        field('Regatta', 'regatta', r.event.regatta, { placeholder: 'Muskoka Fall Classic' }),
        field('Event number', 'number', r.event.number, { type: 'number', min: '0' }),
        field('Date', 'date', r.event.date, { type: 'date' }),
        field('Scheduled race time', 'time', r.event.time, { type: 'time' }),
        field('Timezone', 'timezone', r.event.timezone, { list: 'zones' }),
        selectField('Format', 'format', r.event.format, [
          ['sprint', 'Sprint (lanes)'],
          ['head', 'Head race (bow numbers)'],
        ]),
        field('Distance (m)', 'distance', r.event.distance, { type: 'number', min: '0' }),
        field('Running late by (min)', 'delayMinutes', r.delayMinutes, {
          type: 'number',
          min: '0',
        }),
        field('Venue', 'venueName', r.venue.name, { placeholder: 'Gull Lake Rotary Park' }),
        field('Town', 'venueTown', r.venue.town, { placeholder: 'Gravenhurst, ON' }),
        field('Map URL', 'mapUrl', r.venue.mapUrl, { type: 'url', full: true }),
        field('Parking map URL', 'parkingMapUrl', r.venue.parkingMapUrl, {
          type: 'url',
          full: true,
        }),
        field('Regatta Central link', 'regattaCentral', r.links.regattaCentral, {
          type: 'url',
          full: true,
        }),
        field('Draw / heat sheet link', 'draw', r.links.draw, { type: 'url' }),
        field('Results link', 'results', r.links.results, { type: 'url' }),
      ]),
      zoneList,
      el('div', { class: 'subhead' }, [
        el('div', { class: 'cap', text: 'Milestones — worked back from race start' }),
      ]),
      table,
      el('button', {
        class: 'btn small',
        type: 'button',
        dataset: { act: 'ms-add' },
        text: '+ Add step',
      }),
      el('div', {
        class: 'hint',
        text: 'Each step starts at the race time minus its own duration and every step after it.',
      }),
      el('div', { class: 'subhead' }, [
        field('Race plan', 'plan', r.plan, { tag: 'textarea', full: true }),
      ]),
      el('div', { class: 'subhead' }, [
        field('Kit — one per line', 'kit', r.kit.join('\n'), { tag: 'textarea', full: true }),
      ]),
      el('div', { class: 'ed-actions' }, [
        el('div', {}, [
          el('button', {
            class: 'btn primary',
            type: 'submit',
            text: isNew ? 'Create race' : 'Save changes',
          }),
          el('button', { class: 'btn', type: 'button', dataset: { act: 'cancel' }, text: 'Cancel' }),
        ]),
        el('div', {}, [
          isNew
            ? null
            : el('button', {
                class: 'btn danger',
                type: 'button',
                dataset: { act: 'delete', id: r.id },
                text: 'Delete race',
              }),
        ].filter(Boolean)),
      ]),
    ]
  );

  form.querySelector('#f-kit').setAttribute('style', 'min-height:190px');
  return form;
}

/** Read the editor back into a race object. */
function readEditor() {
  const form = document.getElementById('edform');
  if (!form) return null;
  const g = (name) => {
    const node = form.querySelector('[name="' + name + '"]');
    return node ? node.value.trim() : '';
  };
  const handsIndex = (() => {
    const picked = form.querySelector('[name="hands"]:checked');
    return picked ? Number(picked.value) : -1;
  })();

  const milestones = [];
  form.querySelectorAll('tr[data-ms]').forEach((tr) => {
    const i = Number(tr.dataset.ms);
    milestones.push({
      label: tr.querySelector('[name="ms-label"]').value.trim(),
      minutes: Math.max(0, parseInt(tr.querySelector('[name="ms-minutes"]').value, 10) || 0),
      kind: i === handsIndex ? 'handsOn' : 'normal',
    });
  });

  const name = g('name');
  const existingId = form.dataset.id;
  const id = existingId || uniqueId(buildId(name, g('regatta'), g('date'), g('number')));

  return normaliseRace({
    id,
    planVersion: existingId ? (findRace(existingId) || {}).planVersion || 1 : 1,
    updatedAt: null,
    event: {
      name,
      number: g('number'),
      regatta: g('regatta'),
      date: g('date'),
      time: g('time'),
      timezone: g('timezone') || ZONES[0],
      format: g('format'),
      distance: g('distance'),
    },
    venue: {
      name: g('venueName'),
      town: g('venueTown'),
      mapUrl: g('mapUrl') || autoMapUrl(g('venueName'), g('venueTown')),
      parkingMapUrl: g('parkingMapUrl'),
    },
    links: {
      regattaCentral: g('regattaCentral'),
      draw: g('draw'),
      results: g('results'),
    },
    delayMinutes: g('delayMinutes'),
    milestones: milestones.filter((m) => m.label),
    plan: form.querySelector('[name="plan"]').value,
    kit: form
      .querySelector('[name="kit"]')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    intel: existingId ? (findRace(existingId) || {}).intel : null,
  });
}

function buildId(name, regatta, date, number) {
  const year = (date || '').slice(0, 4);
  const bits = [regatta || name || 'race', year, number ? 'e' + number : ''].filter(Boolean);
  return slug(bits.join(' '));
}

function autoMapUrl(name, town) {
  const q = [name, town].filter(Boolean).join(', ');
  if (!q) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

/** Live "Starts" column while the milestones are being edited. */
function refreshEditorTimes() {
  const form = document.getElementById('edform');
  if (!form) return;
  const draft = readEditor();
  if (!draft) return;
  const tz = zoneOf(draft);
  const rows = buildSchedule(draft);
  const trs = form.querySelectorAll('tr[data-ms]');
  trs.forEach((tr, i) => {
    const cell = tr.querySelector('.at');
    cell.textContent = rows[i] ? fmtTime(rows[i].at, tz) + '  ' + fmtTMinus(rows[i].before) : '—';
  });
  const raceCell = document.getElementById('ms-race');
  if (raceCell) {
    const start = rows.length ? rows[rows.length - 1].at : null;
    raceCell.textContent = start == null ? 'set a date and time' : fmtTime(start, tz);
  }
}

function renumberMilestones() {
  const form = document.getElementById('edform');
  if (!form) return;
  form.querySelectorAll('tr[data-ms]').forEach((tr, i) => {
    tr.dataset.ms = String(i);
    tr.querySelector('[name="hands"]').value = String(i);
  });
}

/* --------------------------------------------------------------------- race */

function raceView(race) {
  const clock = clockBlock(race, { mode: 'owner' });
  const timeline = timelineBlock(race);

  const head = el('div', { class: 'head' }, [
    identityBlock(race, { mode: 'owner' }),
    el('div', { class: 'head-side' }, [
      el('div', { class: 'row' }, [
        el('button', { class: 'btn', type: 'button', dataset: { act: 'edit' }, text: 'Edit plan' }),
        el('button', {
          class: 'btn',
          type: 'button',
          dataset: { act: 'refresh' },
          text: 'Refresh intel',
        }),
        el('button', {
          class: 'btn navy',
          type: 'button',
          dataset: { act: 'copy' },
          text: 'Copy crew link',
        }),
      ]),
      el('div', { class: 'late' }, [
        el('label', { for: 'delay', text: 'Running late by' }),
        el('input', {
          id: 'delay',
          type: 'number',
          min: '0',
          step: '1',
          value: String(race.delayMinutes),
          'aria-label': 'Running late by, minutes',
        }),
        el('span', { text: 'min' }),
      ]),
    ]),
  ]);

  const intel = intelBlock(race);
  const plan = planBlock(race);
  const cols = el('div', { class: 'cols' }, [
    el('div', { class: 'col-main' }, [timeline.el, plan].filter(Boolean)),
    el('div', { class: 'col-side' }, [intel].filter(Boolean)),
  ]);

  const footer = el('footer', { class: 'foot' }, [
    el('span', { class: 'by', text: 'Plan v' + race.planVersion + ' · saved on this device' }),
    el('div', { class: 'acts' }, [
      el('button', { class: 'btn', type: 'button', dataset: { act: 'ics' }, text: 'Add to calendar' }),
      el('button', { class: 'btn', type: 'button', dataset: { act: 'print' }, text: 'Print' }),
      el('button', {
        class: 'btn danger',
        type: 'button',
        dataset: { act: 'delete', id: race.id },
        text: 'Delete race',
      }),
    ]),
  ]);

  return {
    nodes: [head, clock.el, cols, kitBlock(race), footer].filter(Boolean),
    parts: [clock, timeline],
  };
}

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('h1', { text: 'No races yet' }),
    el('p', {
      text: 'Paste a Regatta Central event link above. The enrich script looks up the event, venue, draw and competitors; you only confirm the plan.',
    }),
  ]);
}

/* ------------------------------------------------------------------- render */

function render() {
  if (stopTicker) {
    stopTicker();
    stopTicker = null;
  }
  const current = editing ? null : selectedRace();
  const nodes = [bar(current || selectedRace()), newRaceRow(), noticeBlock()];

  if (editing) {
    nodes.push(editorBlock(editing === 'new' || editing.rcUrl ? null : findRace(editing)));
  } else if (current) {
    const view = raceView(current);
    nodes.push(...view.nodes);
    stopTicker = startTicker(view.parts);
  } else {
    nodes.push(emptyState());
  }

  app.replaceChildren(...nodes.filter(Boolean));
  if (editing) refreshEditorTimes();
}

/* ------------------------------------------------------------------ actions */

async function importPayload(text, message) {
  const raw = String(text || '').trim();
  const payload = raw.includes('#import=')
    ? raw.split('#import=')[1]
    : raw.includes('/r/#')
      ? raw.split('/r/#')[1]
      : raw.replace(/^#/, '');
  const race = await decodeRace(payload);
  if (!race) {
    toast("That link didn't decode — copy the whole thing");
    return false;
  }
  const races = state.races.slice();
  const at = races.findIndex((r) => r.id === race.id);
  if (at >= 0) races[at] = race;
  else races.push(race);
  editing = null;
  notice = null;
  location.hash = '#' + encodeURIComponent(race.id);
  persist(races, message || (at >= 0 ? 'Race updated' : 'Race added'));
  return true;
}

function enrichCommand(rcUrl, race) {
  if (race) {
    return 'node scripts/enrich.mjs ' + (race.links.regattaCentral || rcUrl || '<event url>') +
      ' --merge races/' + race.id + '.json';
  }
  return 'node scripts/enrich.mjs ' + (rcUrl || '<event url>') + ' --out races/<id>.json';
}

function save() {
  const draft = readEditor();
  if (!draft) return;
  if (!draft.event.name && !draft.event.regatta) {
    toast('Give the race an event name or a regatta');
    return;
  }
  const races = state.races.slice();
  const at = races.findIndex((r) => r.id === draft.id);
  // Every save is a new plan version: that is how the crew tell whether the
  // link they were sent is still current.
  draft.planVersion = at >= 0 ? races[at].planVersion + 1 : 1;
  draft.updatedAt = new Date().toISOString();
  if (at >= 0) races[at] = draft;
  else races.push(draft);
  editing = null;
  location.hash = '#' + encodeURIComponent(draft.id);
  persist(races, at >= 0 ? 'Saved as v' + draft.planVersion : 'Race created');
}

function setDelay(minutes) {
  const race = selectedRace();
  if (!race) return;
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value === race.delayMinutes) return;
  const races = state.races.map((r) =>
    r.id === race.id
      ? { ...r, delayMinutes: value, planVersion: r.planVersion + 1, updatedAt: new Date().toISOString() }
      : r
  );
  persist(
    races,
    value > 0 ? 'Everything shifted by ' + value + ' min — send a new link' : 'Delay cleared'
  );
}

async function copyCrewLink() {
  const race = selectedRace();
  if (!race) return;
  const payload = await encodeRace(race);
  const url = crewUrl(payload, location.origin + '/');
  if (await copyText(url)) toast('Crew link copied · ' + url.length + ' chars');
  else window.prompt('Copy this crew link', url);
}

function deleteRace(id) {
  const race = findRace(id);
  if (!race) return;
  const label = race.event.name || race.id;
  if (!window.confirm('Delete “' + label + '”? This cannot be undone.')) return;
  editing = null;
  if (decodeURIComponent(location.hash.replace(/^#/, '')) === id) {
    history.replaceState(null, '', location.pathname);
  }
  persist(
    state.races.filter((r) => r.id !== id),
    'Race deleted'
  );
}

function exportIcs() {
  const race = selectedRace();
  if (!race) return;
  encodeRace(race).then((payload) => {
    const ics = buildIcs(race, crewUrl(payload, location.origin + '/'));
    if (!ics) {
      toast('Set a date and race time first');
      return;
    }
    downloadFile(slug(race.event.name || race.id) + '.ics', 'text/calendar', ics);
  });
}

/* ------------------------------------------------------------------- events */

app.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'new') {
    notice = null;
    editing = null;
    render();
    const input = document.getElementById('rc-url');
    if (input) input.focus();
  } else if (act === 'manual') {
    editing = { rcUrl: btn.dataset.url || '' };
    notice = null;
    render();
    window.scrollTo(0, 0);
  } else if (act === 'edit') {
    const race = selectedRace();
    if (race) editing = race.id;
    notice = null;
    render();
    window.scrollTo(0, 0);
  } else if (act === 'cancel') {
    editing = null;
    render();
  } else if (act === 'delete') {
    deleteRace(btn.dataset.id);
  } else if (act === 'copy') {
    copyCrewLink();
  } else if (act === 'ics') {
    exportIcs();
  } else if (act === 'print') {
    window.print();
  } else if (act === 'refresh') {
    const race = selectedRace();
    notice = {
      title: 'Refresh the intel from a terminal',
      lines: [
        'The page cannot fetch Regatta Central itself (CORS), so run the enrich script and paste the import link it prints. --merge keeps your milestones, plan, kit and delay.',
      ],
      command: enrichCommand(null, race),
      accept: true,
    };
    render();
  } else if (act === 'copy-cmd') {
    copyText(notice && notice.command).then((ok) =>
      toast(ok ? 'Command copied' : 'Select and copy the command')
    );
  } else if (act === 'hands-clear') {
    const picked = document.querySelector('[name="hands"]:checked');
    if (picked) picked.checked = false;
  } else if (act === 'ms-add') {
    const body = document.querySelector('#mstable tbody');
    const n = body.querySelectorAll('tr[data-ms]').length;
    body.insertBefore(milestoneRow({ label: '', minutes: 10, kind: 'normal' }, n), body.lastElementChild);
    renumberMilestones();
    refreshEditorTimes();
    body.querySelectorAll('tr[data-ms] [name="ms-label"]')[n].focus();
  } else if (act === 'ms-del') {
    btn.closest('tr').remove();
    renumberMilestones();
    refreshEditorTimes();
  } else if (act === 'ms-up' || act === 'ms-down') {
    const tr = btn.closest('tr');
    const sib = act === 'ms-up' ? tr.previousElementSibling : tr.nextElementSibling;
    if (!sib || !sib.dataset.ms) return;
    if (act === 'ms-up') tr.parentNode.insertBefore(tr, sib);
    else tr.parentNode.insertBefore(sib, tr);
    renumberMilestones();
    refreshEditorTimes();
  }
});

app.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  if (form.id === 'edform') {
    save();
  } else if (form.id === 'newrace') {
    const url = form.querySelector('[name="rc"]').value.trim();
    if (!url) {
      toast('Paste the Regatta Central event link first');
      return;
    }
    notice = {
      title: 'Run the enrich script, then paste its import link',
      lines: [
        'The page cannot fetch Regatta Central itself (CORS). The script reads the event, venue, draw and competitors, then prints a link that adds the race here.',
      ],
      command: enrichCommand(url, null),
      accept: true,
      manual: url,
    };
    render();
  } else if (form.id === 'importform') {
    importPayload(form.querySelector('[name="payload"]').value);
  }
});

app.addEventListener('input', (ev) => {
  if (ev.target.closest('#edform')) refreshEditorTimes();
});

app.addEventListener('change', (ev) => {
  if (ev.target.id === 'delay') setDelay(ev.target.value);
});

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#import=')) {
    installWakeLock();
boot();
    return;
  }
  editing = null;
  notice = null;
  render();
});

/* --------------------------------------------------------------------- boot */

async function boot() {
  if (location.hash.startsWith('#import=')) {
    const payload = location.hash.slice('#import='.length);
    history.replaceState(null, '', location.pathname);
    await importPayload(payload);
    return;
  }
  render();
}

installWakeLock();
boot();
