// Owner view: the race list, the editor and the share links. Only ever loaded
// by `/` — the crew page never sees this file.

import { el, toast } from './view.mjs';

const LS_KEY = 'raceday.state.v2';

const app = document.getElementById('app');

export function readState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.races)) return o;
    }
  } catch (e) {
    /* fall through to a fresh state */
  }
  return { races: [] };
}

export function writeState(next) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    toast('This browser would not save the race');
    return false;
  }
}

function bar(state) {
  return el('div', { class: 'bar' }, [
    el('div', { class: 'brand disp' }, ['Race Day', el('span', { text: 'My races' })]),
    el('div', { class: 'pills' }, [
      el('button', { class: 'pill add', type: 'button', dataset: { act: 'new' }, text: '+ New race' }),
    ]),
  ]);
}

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('h1', { text: 'No races yet' }),
    el('p', { text: 'Paste a Regatta Central event link above to build the first one.' }),
  ]);
}

function render() {
  const state = readState();
  app.replaceChildren(bar(state), emptyState());
}

render();
