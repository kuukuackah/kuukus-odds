// Kuuku's Odds — daily fetch script
//
// Pulls real bookmaker odds from The Odds API, de-vigs them, and writes
// data/picks.json for the static front end to read.
//
// Hard rule: if no bookmaker posts a usable line for a fixture, that
// fixture is EXCLUDED, never estimated. See the `excluded` arrays in
// the output — that's the whole point of this script.
//
// Quota notes (measured against the live API):
//   - a bulk /odds call costs 1 unit per region per market requested
//   - a per-event /events/{id}/odds call costs 1 unit per market requested,
//     regardless of region count
//   - the main /odds `totals` market only carries the book's default line
//     (usually 2.5) — the 1.5 line lives under `alternate_totals`, and the
//     first-half 0.5 line under `alternate_totals_h1` (the plain `totals_h1`
//     market only carries the 1.5 first-half line, not 0.5); both alternate
//     markets are per-event-only (the bulk endpoint rejects them outright)
//   - so getting Over 1.5 + first-half Over 0.5 for a fixture costs 2 units
//     via one combined per-event call — see MAX_EVENT_LOOKUPS_PER_RUN below
import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) {
  console.error('Missing ODDS_API_KEY. Copy .env.example to .env and add your key (or set the repo secret in Actions).');
  process.exit(1);
}

const BASE_URL = 'https://api.the-odds-api.com/v4';
const REGIONS = 'uk'; // single region: each extra region multiplies bulk-call cost
const MAX_EVENT_LOOKUPS_PER_RUN = 20; // 20 events * 2 units = 40 units, plus ~9 bulk units = ~49/run
const MAX_PICKS_PER_MARKET = 30;

// Soccer leagues covering the fixture set discussed — trim or extend as needed.
// Full list of valid sport keys: GET {BASE_URL}/sports?apiKey=...
const SPORTS = [
  'soccer_epl',
  'soccer_efl_champ',
  'soccer_germany_bundesliga',
  'soccer_germany_bundesliga2',
  'soccer_spain_la_liga',
  'soccer_france_ligue_one',
  'soccer_france_ligue_two',
  'soccer_italy_serie_a',
  'soccer_usa_mls',
];

let apiCallCount = 0;
let lastQuotaRemaining = null;
let lastQuotaUsed = null;

async function apiGet(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  apiCallCount += 1;
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  if (remaining !== null) lastQuotaRemaining = remaining;
  if (used !== null) lastQuotaUsed = used;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${url.pathname}${url.search} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Fair probability with the bookmaker's margin removed: divide each side's
// implied probability by the sum of both sides' implied probabilities.
function devig(overOdds, underOdds) {
  const impliedOver = 1 / overOdds;
  const impliedUnder = 1 / underOdds;
  return impliedOver / (impliedOver + impliedUnder);
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Extract fair probabilities for a specific total point (e.g. 1.5) from a
// bookmakers array shaped like the Odds API's totals-style markets.
function fairProbsAtPoint(bookmakers, marketKey, point) {
  const perBook = [];
  for (const book of bookmakers ?? []) {
    const market = book.markets?.find((m) => m.key === marketKey);
    if (!market) continue;
    const over = market.outcomes?.find((o) => o.name === 'Over' && o.point === point);
    const under = market.outcomes?.find((o) => o.name === 'Under' && o.point === point);
    if (!over || !under) continue;
    perBook.push({ book: book.title, prob: devig(over.price, under.price) });
  }
  return perBook;
}

function summarize(perBook) {
  if (perBook.length === 0) return null;
  return {
    fairProbability: Math.round(median(perBook.map((b) => b.prob)) * 1000) / 1000,
    bookCount: perBook.length,
    books: perBook.map((b) => b.book),
  };
}

// Collects every upcoming event across all configured leagues (1 bulk call
// per league, 1 quota unit each with a single region) before spending any
// budget on the more expensive per-event lookups.
//
// Returned in round-robin order across leagues (one fixture from each
// league per round, repeating) rather than league-by-league — otherwise
// whichever league is first in SPORTS and has the most fixtures (EPL)
// silently eats the entire MAX_EVENT_LOOKUPS_PER_RUN budget every run,
// and every other configured league never gets a single pick.
async function collectEvents() {
  const byLeague = new Map();
  for (const sportKey of SPORTS) {
    try {
      const leagueEvents = await apiGet(`/sports/${sportKey}/odds`, {
        regions: REGIONS,
        markets: 'totals',
      });
      byLeague.set(sportKey, leagueEvents.map((event) => ({ sportKey, event })));
    } catch (err) {
      console.warn(`[${sportKey}] bulk fetch failed, skipping league: ${err.message}`);
      byLeague.set(sportKey, []);
    }
  }

  const interleaved = [];
  let round = 0;
  let addedThisRound = true;
  while (addedThisRound) {
    addedThisRound = false;
    for (const sportKey of SPORTS) {
      const list = byLeague.get(sportKey);
      if (round < list.length) {
        interleaved.push(list[round]);
        addedThisRound = true;
      }
    }
    round += 1;
  }
  return interleaved;
}

async function main() {
  const entries = await collectEvents();
  console.log(`Found ${entries.length} upcoming fixtures across ${SPORTS.length} leagues.`);

  const over15 = [];
  const firstHalfOver05 = [];

  for (const [index, { sportKey, event }] of entries.entries()) {
    const fixture = `${event.home_team} v ${event.away_team}`;
    const base = { fixture, sport: sportKey, commenceTime: event.commence_time };

    if (index >= MAX_EVENT_LOOKUPS_PER_RUN) {
      over15.push({ ...base, excluded: true, reason: 'lookup budget exhausted for this run' });
      firstHalfOver05.push({ ...base, excluded: true, reason: 'lookup budget exhausted for this run' });
      continue;
    }

    try {
      const eventOdds = await apiGet(`/sports/${sportKey}/events/${event.id}/odds`, {
        regions: REGIONS,
        markets: 'alternate_totals,alternate_totals_h1',
      });

      const line15 = summarize(fairProbsAtPoint(eventOdds.bookmakers, 'alternate_totals', 1.5));
      over15.push(line15 ? { ...base, ...line15 } : { ...base, excluded: true, reason: 'no 1.5 line available' });

      const halfLine05 = summarize(fairProbsAtPoint(eventOdds.bookmakers, 'alternate_totals_h1', 0.5));
      firstHalfOver05.push(
        halfLine05 ? { ...base, ...halfLine05 } : { ...base, excluded: true, reason: 'no first-half 0.5 line available' }
      );
    } catch (err) {
      const reason = `lookup failed: ${err.message}`;
      over15.push({ ...base, excluded: true, reason });
      firstHalfOver05.push({ ...base, excluded: true, reason });
    }
  }

  const over15Ranked = rank(over15, MAX_PICKS_PER_MARKET);
  const firstHalfRanked = rank(firstHalfOver05, MAX_PICKS_PER_MARKET);

  const output = {
    generatedAt: new Date().toISOString(),
    apiCallsUsed: apiCallCount,
    apiQuotaUsed: lastQuotaUsed !== null ? Number(lastQuotaUsed) : null,
    apiQuotaRemaining: lastQuotaRemaining !== null ? Number(lastQuotaRemaining) : null,
    over1_5: over15Ranked.picks,
    over1_5_excluded: over15Ranked.excluded,
    firstHalfOver0_5: firstHalfRanked.picks,
    firstHalfOver0_5_excluded: firstHalfRanked.excluded,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/picks.json', JSON.stringify(output, null, 2));
  console.log(
    `Wrote data/picks.json — ${over15Ranked.picks.length} Over 1.5 picks, ${firstHalfRanked.picks.length} first-half picks, ` +
    `${apiCallCount} calls this run (quota: ${lastQuotaUsed ?? '?'} used / ${lastQuotaRemaining ?? '?'} remaining).`
  );
}

function rank(picks, cap) {
  const withProb = picks.filter((p) => !p.excluded).sort((a, b) => b.fairProbability - a.fairProbability);
  const excluded = picks.filter((p) => p.excluded);
  return {
    picks: withProb.slice(0, cap),
    excluded,
  };
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
