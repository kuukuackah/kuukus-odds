// Kuuku's Odds — track record scorer
//
// Checks already-committed picks (data/picks.json, data/win-draw.json —
// the files as they were BEFORE this run's fetch scripts overwrite them)
// against real final scores, and tallies a running hit-rate per market
// into data/track-record.json.
//
// Uses TheSportsDB's free tier (same key "123" as fetch-team-badges.js) —
// completely separate from the Odds API and RapidAPI quotas, so this never
// competes with picks-fetching for budget. One call per distinct fixture
// date covers every league in a single request.
//
// Only full-time scores are available on the free tier, so this covers
// Over 1.5, Straight Win, and Win or Draw — NOT first-half Over 0.5 (no
// free source exposes half-time scores). Hard rule, same as the rest of
// this project: a fixture that can't be confidently matched to a real
// result is skipped, never guessed — it just gets picked up again on a
// later run if the data catches up.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const MAX_SCORED_KEYS = 2000; // dedup safety net against unbounded growth
const FINISH_BUFFER_MS = 3 * 60 * 60 * 1000; // don't look up a fixture until 3hrs after kickoff

function normalizeTeam(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|cd|ud|if|bk|sk)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamsMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function dateOnly(isoLike) {
  return String(isoLike).slice(0, 10);
}

function fixtureKey(market, dateStr, home, away) {
  return `${market}|${dateStr}|${normalizeTeam(home)}|${normalizeTeam(away)}`;
}

async function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchDayResults(dateStr) {
  const url = `${API_BASE}/eventsday.php?d=${dateStr}&s=Soccer`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.events || [];
}

function findResult(events, home, away) {
  const h = normalizeTeam(home);
  const a = normalizeTeam(away);
  return events.find((e) => teamsMatch(normalizeTeam(e.strHomeTeam), h) && teamsMatch(normalizeTeam(e.strAwayTeam), a)) || null;
}

// Fixtures whose kickoff is well in the past and that haven't been scored yet.
function collectCandidates(picks, market, now, scoredKeys) {
  const candidates = [];
  for (const p of picks || []) {
    if (p.excluded || !p.commenceTime) continue;
    const kickoff = new Date(p.commenceTime);
    if (Number.isNaN(kickoff.getTime())) continue;
    if (now.getTime() - kickoff.getTime() < FINISH_BUFFER_MS) continue; // not finished yet (or already in the future)
    const [home, away] = String(p.fixture).split(' v ');
    if (!home || !away) continue;
    const date = dateOnly(p.commenceTime);
    const key = fixtureKey(market, date, home, away);
    if (scoredKeys.has(key)) continue;
    candidates.push({ market, key, date, home, away, pick: p });
  }
  return candidates;
}

function isOver15Hit(event) {
  return Number(event.intHomeScore) + Number(event.intAwayScore) >= 2;
}

function isStraightWinHit(event, favoriteTeam) {
  const favIsHome = teamsMatch(normalizeTeam(event.strHomeTeam), normalizeTeam(favoriteTeam));
  const homeScore = Number(event.intHomeScore);
  const awayScore = Number(event.intAwayScore);
  return favIsHome ? homeScore > awayScore : awayScore > homeScore;
}

function isWinOrDrawHit(event, favoriteTeam) {
  const favIsHome = teamsMatch(normalizeTeam(event.strHomeTeam), normalizeTeam(favoriteTeam));
  const homeScore = Number(event.intHomeScore);
  const awayScore = Number(event.intAwayScore);
  return favIsHome ? homeScore >= awayScore : awayScore >= homeScore;
}

function emptyRecord() {
  return {
    updatedAt: null,
    markets: {
      over1_5: { hits: 0, total: 0 },
      straightWin: { hits: 0, total: 0 },
      winOrDraw: { hits: 0, total: 0 },
    },
    scoredFixtureKeys: [],
  };
}

async function main() {
  const picksData = await readJsonSafe('data/picks.json', {});
  const winDrawData = await readJsonSafe('data/win-draw.json', {});
  const record = await readJsonSafe('data/track-record.json', emptyRecord());
  for (const market of ['over1_5', 'straightWin', 'winOrDraw']) {
    record.markets[market] ||= { hits: 0, total: 0 };
  }

  const scoredKeys = new Set(record.scoredFixtureKeys || []);
  const now = new Date();

  const candidates = [
    ...collectCandidates(picksData.over1_5, 'over1_5', now, scoredKeys),
    ...collectCandidates(winDrawData.straightWin, 'straightWin', now, scoredKeys),
    ...collectCandidates(winDrawData.winOrDraw, 'winOrDraw', now, scoredKeys),
  ];

  if (candidates.length === 0) {
    console.log('No finished fixtures ready to score this run.');
    await mkdir('data', { recursive: true });
    await writeFile('data/track-record.json', JSON.stringify(record, null, 2));
    return;
  }

  const distinctDates = [...new Set(candidates.map((c) => c.date))];
  const eventsByDate = new Map();
  for (const date of distinctDates) {
    try {
      eventsByDate.set(date, await fetchDayResults(date));
    } catch (err) {
      console.warn(`Could not fetch results for ${date}: ${err.message}`);
      eventsByDate.set(date, []);
    }
  }

  let scoredCount = 0;
  let unmatchedCount = 0;
  for (const c of candidates) {
    const events = eventsByDate.get(c.date) || [];
    const event = findResult(events, c.home, c.away);
    if (!event || event.strStatus !== 'FT' || event.intHomeScore === null || event.intAwayScore === null) {
      unmatchedCount += 1;
      continue; // never guess — try again next run in case the data source catches up
    }

    let hit;
    if (c.market === 'over1_5') hit = isOver15Hit(event);
    else if (c.market === 'straightWin') hit = isStraightWinHit(event, c.pick.favoriteTeam);
    else hit = isWinOrDrawHit(event, c.pick.favoriteTeam);

    record.markets[c.market].total += 1;
    if (hit) record.markets[c.market].hits += 1;
    scoredKeys.add(c.key);
    scoredCount += 1;
  }

  record.scoredFixtureKeys = [...scoredKeys].slice(-MAX_SCORED_KEYS);
  record.updatedAt = now.toISOString();

  await mkdir('data', { recursive: true });
  await writeFile('data/track-record.json', JSON.stringify(record, null, 2));
  console.log(
    `Track record updated — ${scoredCount} fixtures scored, ${unmatchedCount} unmatched/skipped this run. ` +
    `Totals: Over 1.5 ${record.markets.over1_5.hits}/${record.markets.over1_5.total}, ` +
    `Straight Win ${record.markets.straightWin.hits}/${record.markets.straightWin.total}, ` +
    `Win or Draw ${record.markets.winOrDraw.hits}/${record.markets.winOrDraw.total}.`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
