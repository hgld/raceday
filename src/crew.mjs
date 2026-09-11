// Crew view: one race, read-only, decoded from the link. Loads core + view
// only — there is no path from here to the editor.

import { decodeRace, buildIcs, slug } from './core.mjs';
import {
  identityBlock,
  clockBlock,
  timelineBlock,
  planBlock,
  intelBlock,
  kitBlock,
  footerBlock,
  installWakeLock,
  startTicker,
  downloadFile,
  el,
} from './view.mjs';

const app = document.getElementById('app');

function payloadFromHash() {
  let h = location.hash.replace(/^#/, '');
  if (!h) return '';
  if (h.indexOf('%') >= 0) {
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      /* leave as-is */
    }
  }
  return h.trim();
}

function renderInvalid() {
  app.replaceChildren(
    el('div', { class: 'empty' }, [
      el('h1', { text: "This link isn't valid" }),
      el('p', {
        text: 'Ask Henry to send the race-day link again — links carry the whole plan, so a truncated one will not open.',
      }),
    ])
  );
}

function render(race) {
  const title = [race.event.name, race.event.regatta].filter(Boolean).join(' · ');
  if (title) document.title = title + ' — Race Day';

  const clock = clockBlock(race, { mode: 'crew' });
  const timeline = timelineBlock(race);

  const footer = footerBlock({
    note: 'Shared by Henry · view only',
    actions: [{ act: 'ics', label: 'Add to calendar' }],
  });
  footer.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act="ics"]');
    if (!b) return;
    const ics = buildIcs(race, location.href);
    if (ics) downloadFile(slug(race.event.name || race.id) + '.ics', 'text/calendar', ics);
  });

  app.replaceChildren(
    ...[
      identityBlock(race, { mode: 'crew' }),
      clock.el,
      timeline.el,
      planBlock(race),
      intelBlock(race),
      kitBlock(race),
      footer,
    ].filter(Boolean)
  );

  startTicker([clock, timeline]);
  installWakeLock();
}

async function boot() {
  const payload = payloadFromHash();
  if (!payload) return renderInvalid();
  const race = await decodeRace(payload);
  if (!race) return renderInvalid();
  render(race);
}

window.addEventListener('hashchange', () => location.reload());
boot();
