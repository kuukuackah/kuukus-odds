// Kuuku's Odds — team badge enrichment
//
// Reads today's already-generated picks files, finds every unique team
// name across all sports, and looks up a real badge/crest image for each
// one from TheSportsDB (free tier, key "123", real-time verified against
// the live API — see README for the licensing note: this is used with
// the site owner's explicit, informed authorization given TheSportsDB's
// free-tier terms scope usage to "development projects").
//
// Results are cached in data/team-badges.json and persist across runs —
// once a team is found, it's never looked up again, so this gets cheaper
// over time rather than more expensive. Only genuinely new teams cost a
// request. Capped per run to stay well under TheSportsDB's free-tier
// rate limit (30 requests/minute).
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const MAX_LOOKUPS_PER_RUN = 40;
const DELAY_MS = 2200; // well under 30/min (1 per 2s)

async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function extractTeams(fixture) {
  const parts = String(fixture).split(' v ');
  return parts.length === 2 ? parts : [];
}

async function collectTeamNames() {
  const names = new Set();

  const picks = await readJsonSafe('data/picks.json');
  for (const p of [...(picks?.over1_5 || []), ...(picks?.firstHalfOver0_5 || [])]) {
    extractTeams(p.fixture).forEach((t) => names.add(t));
  }

  const winDraw = await readJsonSafe('data/win-draw.json');
  for (const p of [...(winDraw?.winOrDraw || []), ...(winDraw?.straightWin || [])]) {
    extractTeams(p.fixture).forEach((t) => names.add(t));
  }

  const nfl = await readJsonSafe('data/nfl.json');
  for (const p of nfl?.moneyline || []) {
    extractTeams(p.fixture).forEach((t) => names.add(t));
  }

  const mlb = await readJsonSafe('data/mlb.json');
  for (const p of mlb?.moneyline || []) {
    extractTeams(p.fixture).forEach((t) => names.add(t));
  }

  return [...names];
}

async function lookupBadge(teamName) {
  const url = `${API_BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  const team = (data.teams || [])[0];
  return team?.strBadge || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const allTeamNames = await collectTeamNames();
  const cache = (await readJsonSafe('data/team-badges.json')) || {};

  const unseen = allTeamNames.filter((name) => !(name in cache));
  const toLookup = unseen.slice(0, MAX_LOOKUPS_PER_RUN);

  console.log(`${allTeamNames.length} unique teams today, ${unseen.length} not yet cached, looking up ${toLookup.length} this run.`);

  let found = 0;
  for (const name of toLookup) {
    try {
      const badge = await lookupBadge(name);
      cache[name] = badge; // null is a valid cached result — means "not found", don't re-query every run
      if (badge) found += 1;
    } catch (err) {
      console.warn(`Lookup failed for "${name}": ${err.message}`);
      // don't cache on error — retry next run
    }
    await sleep(DELAY_MS);
  }

  await mkdir('data', { recursive: true });
  await writeFile('data/team-badges.json', JSON.stringify(cache, null, 2));
  console.log(`Wrote data/team-badges.json — ${found}/${toLookup.length} new badges found this run, ${Object.keys(cache).length} total cached.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
