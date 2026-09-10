// Kuuku's Odds — track record scorer
//
// Checks already-committed picks (data/picks.json, data/win-draw.json —
// the files as they were BEFORE this run's fetch scripts overwrite them)
// against real final scores, and tallies a running hit-rate per market
// into data/track-record.json.
//
// Uses API-Football (api-sports.io) — a completely separate account/quota
// from the Odds API and RapidAPI, so this never competes with picks-
// fetching for budget. GET /fixtures?date=YYYY-MM-DD returns every match
// worldwide for that date in one unpaginated call (verified: 300+ fixtures
// per day, no pagination needed), a huge step up from the free tier of
// TheSportsDB this replaced, which capped at exactly 3 events/day
// regardless of date — verified empirically, not documented anywhere.
//
// Only full-time scores are available, so this covers Over 1.5, Straight
// Win, and Win or Draw — NOT first-half Over 0.5 (no free source exposes
// half-time scores). Hard rule, same as the rest of this project: a
// fixture that can't be confidently matched to a real result is skipped,
// never guessed — it just gets picked up again on a later run.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.API_FOOTBALL_KEY;
if (!API_KEY) {
  console.warn('API_FOOTBALL_KEY not set — skipping track record scoring this run.');
  process.exit(0);
}

const API_BASE = 'https://v3.football.api-sports.io';
const MAX_SCORED_KEYS = 2000; // dedup safety net against unbounded growth
const HISTORY_DAYS = 14; // how many days of the results list the front end shows
const FINISH_BUFFER_MS = 3 * 60 * 60 * 1000; // don't look up a fixture until 3hrs after kickoff

// Some fixtures land a calendar day later in API-Football's date bucketing
// than in our pick sources (verified: a Guatemala match filed under the
// next UTC day) — check the pick's own date first, then +1 day.
const DATE_FALLBACK_DAYS = 1;

// Youth/reserve fixtures share a parent club's name (e.g. "Napoli" also
// fields "Napoli U19"), so naive name matching can silently score the
// wrong game — verified this happens (matched "Napoli v Arsenal" to the
// U19 fixture in testing). Exclude anything that looks like one.
const YOUTH_RESERVE_PATTERN = /\bu-?1[7-9]\b|\bu-?2[0-3]\b|\byouth\b|\breserves?\b/i;

function normalizeTeam(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|cd|ud|if|bk|sk|al|el)\b/g, '') // common suffixes + Arabic/Spanish definite articles
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Small edit distance so name variants (e.g. "Zhenis" vs "Zhenys") still
// match, without being loose enough to conflate two different teams.
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function teamsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) return false; // too short for fuzzy matching to be safe
  const maxDistance = maxLen <= 8 ? 1 : 2;
  return levenshtein(a, b) <= maxDistance;
}

function isYouthOrReserve(fixture) {
  return YOUTH_RESERVE_PATTERN.test(fixture.teams.home.name)
    || YOUTH_RESERVE_PATTERN.test(fixture.teams.away.name)
    || YOUTH_RESERVE_PATTERN.test(fixture.league.name);
}

function dateOnly(isoLike) {
  return String(isoLike).slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

const quota = { callCount: 0, quotaLimit: null, quotaRemaining: null };

async function fetchDayResults(dateStr) {
  const res = await fetch(`${API_BASE}/fixtures?date=${dateStr}`, {
    headers: { 'x-apisports-key': API_KEY },
  });
  quota.callCount += 1;
  const limit = res.headers.get('x-ratelimit-requests-limit');
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (limit !== null) quota.quotaLimit = Number(limit);
  if (remaining !== null) quota.quotaRemaining = Number(remaining);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }
  return (data.response || []).filter((f) => !isYouthOrReserve(f));
}

function findResult(events, home, away) {
  const h = normalizeTeam(home);
  const a = normalizeTeam(away);
  return events.find((f) => teamsMatch(normalizeTeam(f.teams.home.name), h) && teamsMatch(normalizeTeam(f.teams.away.name), a)) || null;
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

function isOver15Hit(fixture) {
  return Number(fixture.goals.home) + Number(fixture.goals.away) >= 2;
}

function isStraightWinHit(fixture, favoriteTeam) {
  const favIsHome = teamsMatch(normalizeTeam(fixture.teams.home.name), normalizeTeam(favoriteTeam));
  const homeScore = Number(fixture.goals.home);
  const awayScore = Number(fixture.goals.away);
  return favIsHome ? homeScore > awayScore : awayScore > homeScore;
}

function isWinOrDrawHit(fixture, favoriteTeam) {
  const favIsHome = teamsMatch(normalizeTeam(fixture.teams.home.name), normalizeTeam(favoriteTeam));
  const homeScore = Number(fixture.goals.home);
  const awayScore = Number(fixture.goals.away);
  return favIsHome ? homeScore >= awayScore : awayScore >= homeScore;
}

function emptyRecord() {
  return {
    updatedAt: null,
    apiFootballCallsUsed: 0,
    apiFootballQuotaUsed: null,
    apiFootballQuotaRemaining: null,
    markets: {
      over1_5: { hits: 0, total: 0 },
      straightWin: { hits: 0, total: 0 },
      winOrDraw: { hits: 0, total: 0 },
    },
    scoredFixtureKeys: [],
    history: [],
  };
}

async function main() {
  const picksData = await readJsonSafe('data/picks.json', {});
  const winDrawData = await readJsonSafe('data/win-draw.json', {});
  const record = await readJsonSafe('data/track-record.json', emptyRecord());
  for (const market of ['over1_5', 'straightWin', 'winOrDraw']) {
    record.markets[market] ||= { hits: 0, total: 0 };
  }
  record.history ||= [];

  const scoredKeys = new Set(record.scoredFixtureKeys || []);
  const now = new Date();

  const candidates = [
    ...collectCandidates(picksData.over1_5, 'over1_5', now, scoredKeys),
    ...collectCandidates(winDrawData.straightWin, 'straightWin', now, scoredKeys),
    ...collectCandidates(winDrawData.winOrDraw, 'winOrDraw', now, scoredKeys),
  ];

  const finish = async () => {
    record.apiFootballCallsUsed = quota.callCount;
    record.apiFootballQuotaUsed = quota.quotaLimit !== null && quota.quotaRemaining !== null ? quota.quotaLimit - quota.quotaRemaining : record.apiFootballQuotaUsed ?? null;
    record.apiFootballQuotaRemaining = quota.quotaRemaining !== null ? quota.quotaRemaining : record.apiFootballQuotaRemaining ?? null;
    await mkdir('data', { recursive: true });
    await writeFile('data/track-record.json', JSON.stringify(record, null, 2));
  };

  if (candidates.length === 0) {
    console.log('No finished fixtures ready to score this run.');
    await finish();
    return;
  }

  // Fetch each distinct date once, plus its +1 fallback, cached so no date
  // is ever requested twice even across many candidates.
  const distinctDates = [...new Set(candidates.map((c) => c.date))];
  const datesToFetch = new Set();
  for (const date of distinctDates) {
    datesToFetch.add(date);
    datesToFetch.add(addDays(date, DATE_FALLBACK_DAYS));
  }
  const eventsByDate = new Map();
  for (const date of datesToFetch) {
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
    const primaryEvents = eventsByDate.get(c.date) || [];
    const fallbackEvents = eventsByDate.get(addDays(c.date, DATE_FALLBACK_DAYS)) || [];
    const fixture = findResult(primaryEvents, c.home, c.away) || findResult(fallbackEvents, c.home, c.away);
    if (!fixture || fixture.fixture.status.short !== 'FT' || fixture.goals.home === null || fixture.goals.away === null) {
      unmatchedCount += 1;
      continue; // never guess — try again next run in case the data source catches up
    }

    let hit;
    if (c.market === 'over1_5') hit = isOver15Hit(fixture);
    else if (c.market === 'straightWin') hit = isStraightWinHit(fixture, c.pick.favoriteTeam);
    else hit = isWinOrDrawHit(fixture, c.pick.favoriteTeam);

    record.markets[c.market].total += 1;
    if (hit) record.markets[c.market].hits += 1;
    record.history.push({ date: c.date, market: c.market, fixture: `${c.home} v ${c.away}`, hit });
    scoredKeys.add(c.key);
    scoredCount += 1;
  }

  const historyCutoff = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  record.history = record.history
    .filter((h) => new Date(h.date) >= historyCutoff)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  record.scoredFixtureKeys = [...scoredKeys].slice(-MAX_SCORED_KEYS);
  record.updatedAt = now.toISOString();

  await finish();
  console.log(
    `Track record updated — ${scoredCount} fixtures scored, ${unmatchedCount} unmatched/skipped this run ` +
    `(${quota.callCount} API-Football calls, ${quota.quotaRemaining ?? '?'} remaining today). ` +
    `Totals: Over 1.5 ${record.markets.over1_5.hits}/${record.markets.over1_5.total}, ` +
    `Straight Win ${record.markets.straightWin.hits}/${record.markets.straightWin.total}, ` +
    `Win or Draw ${record.markets.winOrDraw.hits}/${record.markets.winOrDraw.total}.`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
