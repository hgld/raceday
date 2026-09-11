// Print the crew link and owner import link for a race JSON file.
//   node scripts/link.mjs races/<id>.json [--delay 10] [--origin http://localhost:4173]

import { readFile } from 'node:fs/promises';
import { encodeRace, normaliseRace, crewUrl, importUrl } from '../src/core.mjs';

export async function linksFor(race, origin) {
  const payload = await encodeRace(race);
  return {
    payload,
    crew: crewUrl(payload, origin),
    import: importUrl(payload, origin),
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node scripts/link.mjs races/<id>.json [--delay N] [--origin URL]');
    process.exit(1);
  }
  const flag = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : null;
  };
  const origin = (flag('origin') || 'https://raceday.vercel.app').replace(/\/+$/, '') + '/';
  const race = normaliseRace(JSON.parse(await readFile(file, 'utf8')));
  if (flag('delay')) race.delayMinutes = Number(flag('delay'));

  const l = await linksFor(race, origin);
  console.log('payload  ' + l.payload.length + ' chars');
  console.log('crew     ' + l.crew);
  console.log('import   ' + l.import);
}
