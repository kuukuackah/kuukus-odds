# Kuuku's Odds

A static site that updates once a day with soccer fixtures ranked by fair
(de-vigged) implied probability, pulled from real bookmaker odds:

- **Over 1.5 goals** — up to 30 fixtures
- **First-half Over 0.5 goals** — best-effort; many books don't post this
  line until close to kickoff, so it can be thin or empty on any given day

**The rule this project is built around:** if no bookmaker posts a usable
line for a fixture, that fixture is left out of the list — never estimated.
Excluded fixtures are still shown, collapsed, with the reason.

No server, no database. A script fetches odds, writes a JSON file, and a
GitHub Action commits it daily. GitHub Pages serves the static HTML that
reads that JSON.

## How it works

1. `fetch-odds.js` calls [The Odds API](https://the-odds-api.com/) for a
   set of soccer leagues, pulls the `totals` (and `h1_totals`) markets,
   de-vigs each bookmaker's Over/Under pair, and takes the **median** fair
   probability across books per fixture.
2. Fixtures missing a 1.5 line in the bulk response get a per-event
   `alternate_totals` lookup, capped at 40 calls per run to protect your
   monthly quota.
3. Results are written to `data/picks.json`.
4. `index.html` fetches that JSON and renders two tables, client-side, no
   build step.
5. A GitHub Actions workflow (`.github/workflows/daily-update.yml`) runs
   the script every day at 06:00 UTC and commits the updated JSON.

## Run it locally first

You don't need GitHub for this part.

```bash
npm install
cp .env.example .env
# edit .env and add your free Odds API key
npm run fetch
```

That writes a real `data/picks.json`. Then view the site:

```bash
npm run serve
```

Open `http://localhost:8080` in a browser. (Opening `index.html` directly
via `file://` also mostly works, but some browsers block `fetch()` on
`file://` — a local server avoids that.)

## Getting an Odds API key

1. Sign up free at [the-odds-api.com](https://the-odds-api.com/) — 500
   requests/month on the free tier.
2. Copy your key into `.env` as `ODDS_API_KEY=...` for local runs.

**Note:** `alternate_totals` and `h1_totals` are separate markets and may
have different quota costs or plan requirements — check your Odds API
dashboard if the script logs warnings about a league failing to fetch.
The script degrades gracefully (skips the league, keeps going) rather than
crashing.

## Going live on GitHub

Only do this once you're happy with the local output.

1. Create a new GitHub repo and push this folder to it.
2. In the repo, go to **Settings → Secrets and variables → Actions** and
   add a repository secret named `ODDS_API_KEY` with your key.
3. Go to **Settings → Pages**, set source to **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
4. Go to the **Actions** tab, select **Daily Odds Update**, and click
   **Run workflow** to test it manually before trusting the 06:00 UTC
   cron.
5. Once it runs green and commits a fresh `data/picks.json`, your Pages
   URL will show live picks.

## Adjusting leagues

Edit the `SPORTS` array at the top of `fetch-odds.js`. Full list of valid
sport keys: `GET https://api.the-odds-api.com/v4/sports?apiKey=YOUR_KEY`.
Adding leagues increases API usage — watch your monthly quota.

## What this is (and isn't)

This surfaces what bookmakers already think, cleanly and without the
guesswork of estimating prices by hand. It is **not** an edge over the
market. Prices move — check the current price before staking anything.
