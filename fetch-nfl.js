// Kuuku's Odds — NFL Moneyline fetch script
//
// Uses Tank01's NFL Betting Odds API on RapidAPI — real lines from up to
// 10 real sportsbooks (bet365, DraftKings, FanDuel, BetMGM, Caesars,
// ESPN BET, BetRivers, BallyBet, and others). Free tier: 1,000 requests
// per month, one bulk call per date covers every game that day.
//
// Reuses RAPIDAPI_FOOTBALL_PREDICTION_KEY — despite the name, RapidAPI
// keys are per-account, not per-API, so the same key that unlocked the
// football prediction API works here too once you've separately
// subscribed to Tank01's NFL API on RapidAPI (subscription is per-API,
// the key is not). No new secret needed.
//
// Hard rule, same as the rest of this project: a game with no usable
// moneyline price is excluded, never estimated. NFL has no draw, so this
// is a genuine two-way moneyline market — same de-vig math as a soccer
// Over/Under, just with American odds instead of decimal.

import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.RAPIDAPI_FOOTBALL_PREDICTION_KEY;
if (!API_KEY) {
  console.error('Missing RAPIDAPI_FOOTBALL_PREDICTION_KEY. Add it to .env (or the repo secret in Actions).');
  process.exit(1);
}

const API_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const MAX_PICKS = 30;

const TEAM_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WSH: 'Washington Commanders',
};

function teamName(code) {
  return TEAM_NAMES[code] || code;
}

// American odds -> implied probability.
function americanToImplied(odds) {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function todayGameDate() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const gameDate = process.env.NFL_GAME_DATE || todayGameDate();
  const url = `https://${API_HOST}/getNFLBettingOdds?gameDate=${gameDate}`;
  const res = await fetch(url, {
    headers: { 'x-rapidapi-host': API_HOST, 'x-rapidapi-key': API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const quotaRemaining = res.headers.get('x-ratelimit-requests-remaining');
  const quotaLimit = res.headers.get('x-ratelimit-requests-limit');

  const { body: games } = await res.json();

  const picks = [];
  const excluded = [];

  for (const [gameId, game] of Object.entries(games || {})) {
    const match = gameId.match(/^(\d+)_(\w+)@(\w+)$/);
    if (!match) continue;
    const [, dateStr, awayCode, homeCode] = match;
    const fixture = `${teamName(awayCode)} v ${teamName(homeCode)}`; // away listed first, matching the rest of the site's "Team v Team" convention
    const base = {
      fixture,
      gameDate: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
    };

    const fairHomeProbs = [];
    for (const [key, book] of Object.entries(game)) {
      if (key === 'awayTeam' || key === 'homeTeam' || typeof book !== 'object') continue;
      const awayML = Number(book.awayTeamMLOdds);
      const homeML = Number(book.homeTeamMLOdds);
      if (!Number.isFinite(awayML) || !Number.isFinite(homeML)) continue;
      const impliedAway = americanToImplied(awayML);
      const impliedHome = americanToImplied(homeML);
      fairHomeProbs.push(impliedHome / (impliedAway + impliedHome));
    }

    if (fairHomeProbs.length === 0) {
      excluded.push({ ...base, reason: 'no usable moneyline price' });
      continue;
    }

    const fairHome = median(fairHomeProbs);
    const fairAway = 1 - fairHome;
    const favoriteIsHome = fairHome >= fairAway;

    picks.push({
      ...base,
      favoriteTeam: favoriteIsHome ? teamName(homeCode) : teamName(awayCode),
      fairProbability: Math.round((favoriteIsHome ? fairHome : fairAway) * 1000) / 1000,
      bookCount: fairHomeProbs.length,
    });
  }

  picks.sort((a, b) => b.fairProbability - a.fairProbability);

  const output = {
    generatedAt: new Date().toISOString(),
    gameDate,
    source: 'Tank01 NFL Betting Odds (RapidAPI) — median across real sportsbooks (bet365, DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, BetRivers, BallyBet, and others)',
    quotaUsed: quotaLimit !== null && quotaRemaining !== null ? Number(quotaLimit) - Number(quotaRemaining) : null,
    quotaRemaining: quotaRemaining !== null ? Number(quotaRemaining) : null,
    moneyline: picks.slice(0, MAX_PICKS),
    moneyline_excluded: excluded,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/nfl.json', JSON.stringify(output, null, 2));
  console.log(
    `Wrote data/nfl.json — ${output.moneyline.length} NFL moneyline picks for ${gameDate}, ${excluded.length} excluded, ` +
    `quota: ${output.quotaUsed ?? '?'} used / ${output.quotaRemaining ?? '?'} remaining this month (1 call/run).`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
