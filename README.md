# Kuuku's Odds

A static site that updates once a day with soccer fixtures ranked by fair
(de-vigged) implied probability, pulled from real bookmaker odds:

- **Over 1.5 goals** — up to 30 fixtures
- **First-half Over 0.5 goals** — best-effort; many books don't post this
  line until close to kickoff, so it can be thin or empty on any given day
- **Win or Draw** and **Straight Win** — up to 30 fixtures each, from a
  completely separate free API with its own account and quota (see below).
  Both come from the same single API call — Straight Win costs nothing
  extra on top of Win or Draw.

**The rule this project is built around:** if no bookmaker posts a usable
line for a fixture, that fixture is left out of the list — never estimated.
Excluded fixtures are still shown, collapsed, with the reason.

No server, no database. A script fetches odds, writes a JSON file, and a
GitHub Action commits it daily. GitHub Pages serves the static HTML that
reads that JSON.

## How it works

1. `fetch-odds.js` calls [The Odds API](https://the-odds-api.com/) for a
   set of soccer leagues: one bulk call per league to list fixtures (1
   quota unit each, single region), then one combined per-event call per
   fixture for `alternate_totals` (the 1.5 goals line) and
   `alternate_totals_h1` (the first-half 0.5 line) — 2 quota units per
   fixture looked up, capped at `MAX_EVENT_LOOKUPS_PER_RUN` (20 by default)
   to protect your monthly quota. Each book's Over/Under pair is de-vigged,
   then the **median** fair probability across books is used per fixture.
2. Results are written to `data/picks.json`, including how much of your
   monthly quota is left (`apiQuotaRemaining`), straight from the API's own
   response headers.
3. `index.html` fetches that JSON and renders it client-side — no build
   step, no framework.
4. A GitHub Actions workflow (`.github/workflows/daily-update.yml`) runs
   the script every day at 06:00 UTC and commits the updated JSON.

**Quota budget:** a full run costs roughly `(leagues × 1) + (events looked
up × 2)` quota units — around 49 units/day at the defaults (9 leagues, 20
event lookups), comfortably inside the free 500/month tier for daily runs.
Lower `MAX_EVENT_LOOKUPS_PER_RUN` or trim the `SPORTS` list in
`fetch-odds.js` if you add features that call the API more (nothing in the
front end does — see below).

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

## Getting a Win/Draw API key (separate from the above)

`fetch-1x2.js` uses the **Football Prediction API** (boggio-analytics, via
RapidAPI) — a completely different account, key, and quota from The Odds
API. It provides its own 1X2 (Win/Draw/Win) odds per fixture in a single
bulk call, so even the free tier's 100 calls/month comfortably covers one
call a day.

1. Go to [rapidapi.com/boggio-analytics/api/football-prediction/pricing](https://rapidapi.com/boggio-analytics/api/football-prediction/pricing)
   and subscribe to the **Basic ($0.00/mo)** plan. RapidAPI may ask for a
   card on file even for the free tier (anti-abuse measure) — you
   shouldn't be charged unless you exceed the limits.
2. Grab your key from the **Endpoints** tab (shown in the code snippets as
   `x-rapidapi-key`).
3. Copy it into `.env` as `RAPIDAPI_FOOTBALL_PREDICTION_KEY=...` for local
   runs: `npm run fetch:1x2`.

This source returns **one prediction service's own model odds**, not a
multi-bookmaker median like `fetch-odds.js` — the "Win or Draw" tab says
so explicitly on the site, and `quotedDoubleChanceOdds` in the output can
be `null` for a fixture even when the underlying 1/X/2 odds exist (the
source doesn't always quote the combined price) — the fair probability is
still computed correctly from the individual odds either way.

## Going live on GitHub

Only do this once you're happy with the local output.

1. Create a new GitHub repo and push this folder to it.
2. In the repo, go to **Settings → Secrets and variables → Actions** and
   add two repository secrets: `ODDS_API_KEY` and
   `RAPIDAPI_FOOTBALL_PREDICTION_KEY`.
3. Go to **Settings → Pages**, set source to **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
4. Go to the **Actions** tab, select **Daily Odds Update**, and click
   **Run workflow** to test it manually before trusting the 06:00 UTC
   cron. The Win/Draw fetch step is set to `continue-on-error`, so it
   won't break the Over 1.5 update even if that secret isn't set yet.
5. Once it runs green and commits fresh `data/picks.json` and
   `data/win-draw.json`, your Pages URL will show live picks.

## Adjusting leagues

Edit the `SPORTS` array at the top of `fetch-odds.js`. Full list of valid
sport keys: `GET https://api.the-odds-api.com/v4/sports?apiKey=YOUR_KEY`.
Adding leagues increases API usage — watch your monthly quota.

## Branding & UI (zero API cost)

The logo, favicon, loading screen, search/sort, theme toggle, and stat
cards are all client-side and read only from `data/picks.json` — none of
them call the Odds API, so none of them touch your quota. Only running
`fetch-odds.js` (locally or via the daily Action) spends quota.

- `assets/` holds the generated logo mark and icon set (favicons, Apple
  touch icon, PWA icons). Regenerate them with `python3 scripts/make_logo.py`
  (needs Pillow: `pip install pillow`) if you ever want to tweak the mark.
- `manifest.json` makes the site installable to a phone home screen.

## Posting bet codes (dashboard)

`dashboard.html` is a private page for posting booking codes (SportyBet,
Betway, 1xBet) that show up in the public "My betting codes" tabs on the
main site. It's not linked from the public nav — bookmark the URL
directly (e.g. `https://kuukuackah.github.io/kuukus-odds/dashboard.html`).

There's no server, so there's no login system either — instead, the
dashboard uses a **GitHub personal access token** you create yourself:

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. Scope it to **only** the `kuukuackah/kuukus-odds` repository, with
   **Contents: Read and write** permission and nothing else.
3. Paste the token into the dashboard's "Connect" card. It's saved only in
   that browser's `localStorage` and sent only to `api.github.com` — never
   to me, never to any third party.
4. Post a code and it commits straight to `data/bet-codes.json`; the public
   site picks it up within about a minute (same as the daily odds update).

Anyone can *open* `dashboard.html`, but nobody can post or delete anything
without a valid token scoped to your repo — so the page itself doesn't
need to be secret, just the token does. Don't paste the token anywhere
else, and revoke it from GitHub's settings if you ever suspect it leaked.

The dashboard also shows your current Odds API quota usage (`apiQuotaUsed`
/ `apiQuotaRemaining` from `data/picks.json`) — this replaced the public
"API calls left" stat on the main site, which now shows leagues tracked
instead.

## Tip button (MoMo)

The "Buy me a coffee" button is config-gated and hidden by default. To
enable it, fill in the `TIP_INFO` object near the bottom of the `<script>`
in `index.html`:

```js
const TIP_INFO = {
  network: 'MTN MoMo',
  momoNumber: '0XX XXX XXXX',
  registeredName: 'Your Name',
};
```

Leave `momoNumber` empty to keep the button hidden. This is a static
display only — it doesn't process payments, it just shows your details
in a modal so visitors can send MoMo manually.

## What this is (and isn't)

This surfaces what bookmakers already think, cleanly and without the
guesswork of estimating prices by hand. It is **not** an edge over the
market. Prices move — check the current price before staking anything.
