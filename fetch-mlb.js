// Kuuku's Odds — MLB Moneyline fetch script
//
// Uses Tank01's MLB Betting Odds API on RapidAPI — same provider family
// as fetch-nfl.js, same account key, separate per-API subscription.
// Free tier: 1,000 requests/month, one bulk call per date covers every
// game that day. MLB plays daily during the season (unlike NFL's weekly
// cadence), so this is the most consistently "live" market on the site.
//
// Field names differ slightly from the NFL endpoint (homeTeamML vs
// homeTeamMLOdds, "even" as a literal odds string for +100) — verified
// against the live API rather than assumed, same discipline as the rest
// of this project's data sources.

import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.RAPIDAPI_FOOTBALL_PREDICTION_KEY;
if (!API_KEY) {
  console.error('Missing RAPIDAPI_FOOTBALL_PREDICTION_KEY. Add it to .env (or the repo secret in Actions).');
  process.exit(1);
}

const API_HOST = 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com';
const MAX_PICKS = 30;

const TEAM_NAMES = {
  ARI: 'Arizona Diamondbacks', ATL: 'Atlanta Braves', BAL: 'Baltimore Orioles', BOS: 'Boston Red Sox',
  CHC: 'Chicago Cubs', CHW: 'Chicago White Sox', CIN: 'Cincinnati Reds', CLE: 'Cleveland Guardians',
  COL: 'Colorado Rockies', DET: 'Detroit Tigers', HOU: 'Houston Astros', KC: 'Kansas City Royals',
  LAA: 'Los Angeles Angels', LAD: 'Los Angeles Dodgers', MIA: 'Miami Marlins', MIL: 'Milwaukee Brewers',
  MIN: 'Minnesota Twins', NYM: 'New York Mets', NYY: 'New York Yankees', OAK: 'Athletics',
  PHI: 'Philadelphia Phillies', PIT: 'Pittsburgh Pirates', SD: 'San Diego Padres', SEA: 'Seattle Mariners',
  SF: 'San Francisco Giants', STL: 'St. Louis Cardinals', TB: 'Tampa Bay Rays', TEX: 'Texas Rangers',
  TOR: 'Toronto Blue Jays', WAS: 'Washington Nationals',
};

function teamName(code) {
  return TEAM_NAMES[code] || code;
}

// American odds -> implied probability. "even" is a literal string this
// API uses for +100 (50% implied before de-vig).
function americanToImplied(oddsStr) {
  if (String(oddsStr).toLowerCase() === 'even') return 0.5;
  const odds = Number(oddsStr);
  if (!Number.isFinite(odds)) return null;
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
  const gameDate = process.env.MLB_GAME_DATE || todayGameDate();
  const url = `https://${API_HOST}/getMLBBettingOdds?gameDate=${gameDate}`;
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
    if (!game.awayTeam || !game.homeTeam) continue;
    const fixture = `${teamName(game.awayTeam)} v ${teamName(game.homeTeam)}`;
    const base = {
      fixture,
      gameDate: game.gameDate
        ? `${String(game.gameDate).slice(0, 4)}-${String(game.gameDate).slice(4, 6)}-${String(game.gameDate).slice(6, 8)}`
        : `${gameDate.slice(0, 4)}-${gameDate.slice(4, 6)}-${gameDate.slice(6, 8)}`,
    };

    const fairHomeProbs = [];
    for (const [key, book] of Object.entries(game)) {
      if (['awayTeam', 'homeTeam', 'gameDate', 'gameID', 'teamIDAway', 'teamIDHome', 'last_updated_e_time'].includes(key)) continue;
      if (typeof book !== 'object') continue;
      const impliedAway = americanToImplied(book.awayTeamML);
      const impliedHome = americanToImplied(book.homeTeamML);
      if (impliedAway === null || impliedHome === null) continue;
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
      favoriteTeam: favoriteIsHome ? teamName(game.homeTeam) : teamName(game.awayTeam),
      fairProbability: Math.round((favoriteIsHome ? fairHome : fairAway) * 1000) / 1000,
      bookCount: fairHomeProbs.length,
    });
  }

  picks.sort((a, b) => b.fairProbability - a.fairProbability);

  const output = {
    generatedAt: new Date().toISOString(),
    gameDate,
    source: 'Tank01 MLB Betting Odds (RapidAPI) — median across real sportsbooks (bet365, DraftKings, FanDuel, BetMGM, Caesars, Fanatics, Hard Rock, Rivers Casino, and others)',
    quotaUsed: quotaLimit !== null && quotaRemaining !== null ? Number(quotaLimit) - Number(quotaRemaining) : null,
    quotaRemaining: quotaRemaining !== null ? Number(quotaRemaining) : null,
    moneyline: picks.slice(0, MAX_PICKS),
    moneyline_excluded: excluded,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/mlb.json', JSON.stringify(output, null, 2));
  console.log(
    `Wrote data/mlb.json — ${output.moneyline.length} MLB moneyline picks for ${gameDate}, ${excluded.length} excluded, ` +
    `quota: ${output.quotaUsed ?? '?'} used / ${output.quotaRemaining ?? '?'} remaining this month (1 call/run).`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
