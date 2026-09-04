// Kuuku's Odds — Win/Draw (1X2 double chance) fetch script
//
// Uses a completely separate, free API (Football Prediction API on
// RapidAPI) with its own key and its own quota — none of this touches
// ODDS_API_KEY or its monthly limit.
//
// Source shape: ONE bulk call returns predictions for every fixture
// kicking off in the next 48 hours, each with model-generated 1X2 odds.
// This is a single prediction service's own odds, not a multi-bookmaker
// median like fetch-odds.js — the output is labeled accordingly so it's
// never confused with de-vigged bookmaker consensus.
//
// Hard rule, same as the rest of this project: a fixture with incomplete
// 1X2 odds is excluded, never estimated.

import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';

const API_KEY = process.env.RAPIDAPI_FOOTBALL_PREDICTION_KEY;
if (!API_KEY) {
  console.error('Missing RAPIDAPI_FOOTBALL_PREDICTION_KEY. Add it to .env (or the repo secret in Actions).');
  process.exit(1);
}

const API_HOST = 'football-prediction-api.p.rapidapi.com';
const MAX_PICKS = 30;

function devig3(o1, oX, o2) {
  const i1 = 1 / o1;
  const iX = 1 / oX;
  const i2 = 1 / o2;
  const sum = i1 + iX + i2;
  return { fair1: i1 / sum, fairX: iX / sum, fair2: i2 / sum };
}

async function main() {
  const url = `https://${API_HOST}/api/v2/predictions?market=classic`;
  const res = await fetch(url, {
    headers: { 'x-rapidapi-host': API_HOST, 'x-rapidapi-key': API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const quotaRemaining = res.headers.get('x-ratelimit-match-stats-and-prediction-endpoints-remaining');
  const quotaLimit = res.headers.get('x-ratelimit-match-stats-and-prediction-endpoints-limit');

  const { data: fixtures } = await res.json();

  const picks = [];
  const excluded = [];

  for (const f of fixtures) {
    const fixtureLabel = `${f.home_team} v ${f.away_team}`;
    const base = {
      fixture: fixtureLabel,
      competition: f.competition_cluster ? `${f.competition_cluster} — ${f.competition_name}` : f.competition_name,
      federation: f.federation,
      commenceTime: f.start_date, // as given by the API, no explicit timezone — treated as-is
    };

    const o1 = f.odds?.['1'];
    const oX = f.odds?.['X'];
    const o2 = f.odds?.['2'];
    if (f.status !== 'pending' || f.is_expired || !o1 || !oX || !o2) {
      excluded.push({ ...base, reason: 'no usable 1X2 odds' });
      continue;
    }

    const { fair1, fairX, fair2 } = devig3(o1, oX, o2);
    const favoriteIsHome = fair1 >= fair2;
    const favoriteTeam = favoriteIsHome ? f.home_team : f.away_team;
    const fairProbability = Math.round((favoriteIsHome ? fair1 + fairX : fair2 + fairX) * 1000) / 1000;
    const quotedDoubleChanceOdds = favoriteIsHome ? f.odds['1X'] : f.odds['X2'];

    picks.push({
      ...base,
      favoriteTeam,
      fairProbability,
      quotedDoubleChanceOdds,
    });
  }

  picks.sort((a, b) => b.fairProbability - a.fairProbability);

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'Football Prediction API (boggio-analytics, via RapidAPI) — single-source model odds, not a multi-bookmaker median',
    quotaUsed: quotaLimit !== null && quotaRemaining !== null ? Number(quotaLimit) - Number(quotaRemaining) : null,
    quotaRemaining: quotaRemaining !== null ? Number(quotaRemaining) : null,
    winOrDraw: picks.slice(0, MAX_PICKS),
    winOrDraw_excluded: excluded,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/win-draw.json', JSON.stringify(output, null, 2));
  console.log(
    `Wrote data/win-draw.json — ${output.winOrDraw.length} Win/Draw picks, ${excluded.length} excluded, ` +
    `quota: ${output.quotaUsed ?? '?'} used / ${output.quotaRemaining ?? '?'} remaining this month.`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
