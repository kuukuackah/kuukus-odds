// Kuuku's Odds — daily fetch script
//
// Pulls real bookmaker odds from The Odds API, de-vigs them, and writes
// data/picks.json for the static front end to read.
//
// Hard rule: if no bookmaker posts a usable line for a fixture, that
// fixture is EXCLUDED, never estimated. See the `excluded` arrays in
// the output — that's the whole point of this script.

import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) {
  console.error('Missing ODDS_API_KEY. Copy .env.example to .env and add your key (or set the repo secret in Actions).');
  process.exit(1);
}

const BASE_URL = 'https://api.the-odds-api.com/v4';
const REGIONS = 'uk,us,eu';
const MAX_ALTERNATE_CALLS_PER_RUN = 40; // guardrail against burning the monthly quota
const MAX_PICKS_PER_MARKET = 30;

// Soccer leagues covering the fixture set discussed — trim or extend as needed.
// Full list of valid sport keys: GET {BASE_URL}/sports?apiKey=...
const SPORTS = [
  'soccer_epl',
  'soccer_england_championship',
  'soccer_germany_bundesliga',
  'soccer_germany_bundesliga2',
  'soccer_spain_la_liga',
  'soccer_france_ligue_one',
  'soccer_france_ligue_two',
  'soccer_italy_serie_a',
  'soccer_usa_mls',
];

let apiCallCount = 0;

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
// bookmakers array shaped like the Odds API's `totals` / `alternate_totals`
// / `h1_totals` markets.
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

async function fetchLeague(sportKey) {
  let events;
  try {
    events = await apiGet(`/sports/${sportKey}/odds`, {
      regions: REGIONS,
      markets: 'totals,h1_totals',
    });
  } catch (err) {
    console.warn(`[${sportKey}] bulk fetch failed, skipping league: ${err.message}`);
    return { over15: [], firstHalfOver05: [] };
  }

  const over15 = [];
  const firstHalfOver05 = [];
  const needsAlternate = [];

  for (const event of events) {
    const fixture = `${event.home_team} v ${event.away_team}`;
    const base = {
      fixture,
      sport: sportKey,
      commenceTime: event.commence_time,
    };

    const mainLine15 = summarize(fairProbsAtPoint(event.bookmakers, 'totals', 1.5));
    if (mainLine15) {
      over15.push({ ...base, ...mainLine15 });
    } else {
      needsAlternate.push(event);
    }

    const halfLine05 = summarize(fairProbsAtPoint(event.bookmakers, 'h1_totals', 0.5));
    if (halfLine05) {
      firstHalfOver05.push({ ...base, ...halfLine05 });
    } else {
      firstHalfOver05.push({ ...base, excluded: true, reason: 'no first-half 0.5 line available' });
    }
  }

  // Fixtures with no 1.5 line in the bulk response: try a per-event
  // alternate_totals call, capped so a bad day doesn't burn the quota.
  for (const event of needsAlternate) {
    const fixture = `${event.home_team} v ${event.away_team}`;
    const base = { fixture, sport: sportKey, commenceTime: event.commence_time };

    if (apiCallCount >= MAX_ALTERNATE_CALLS_PER_RUN) {
      over15.push({ ...base, excluded: true, reason: 'no 1.5 line available (alternate-lines call budget exhausted for this run)' });
      continue;
    }

    try {
      const eventOdds = await apiGet(`/sports/${sportKey}/events/${event.id}/odds`, {
        regions: REGIONS,
        markets: 'alternate_totals',
      });
      const altLine15 = summarize(fairProbsAtPoint(eventOdds.bookmakers, 'alternate_totals', 1.5));
      if (altLine15) {
        over15.push({ ...base, ...altLine15 });
      } else {
        over15.push({ ...base, excluded: true, reason: 'no 1.5 line available' });
      }
    } catch (err) {
      over15.push({ ...base, excluded: true, reason: `no 1.5 line available (lookup failed: ${err.message})` });
    }
  }

  return { over15, firstHalfOver05 };
}

function rank(picks, cap) {
  const withProb = picks.filter((p) => !p.excluded).sort((a, b) => b.fairProbability - a.fairProbability);
  const excluded = picks.filter((p) => p.excluded);
  return {
    picks: withProb.slice(0, cap),
    excluded,
  };
}

async function main() {
  const allOver15 = [];
  const allFirstHalf = [];

  for (const sportKey of SPORTS) {
    console.log(`Fetching ${sportKey}...`);
    const { over15, firstHalfOver05 } = await fetchLeague(sportKey);
    allOver15.push(...over15);
    allFirstHalf.push(...firstHalfOver05);
  }

  const over15Ranked = rank(allOver15, MAX_PICKS_PER_MARKET);
  const firstHalfRanked = rank(allFirstHalf, MAX_PICKS_PER_MARKET);

  const output = {
    generatedAt: new Date().toISOString(),
    apiCallsUsed: apiCallCount,
    over1_5: over15Ranked.picks,
    over1_5_excluded: over15Ranked.excluded,
    firstHalfOver0_5: firstHalfRanked.picks,
    firstHalfOver0_5_excluded: firstHalfRanked.excluded,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/picks.json', JSON.stringify(output, null, 2));
  console.log(`Wrote data/picks.json — ${over15Ranked.picks.length} Over 1.5 picks, ${firstHalfRanked.picks.length} first-half picks, ${apiCallCount} API calls used.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
