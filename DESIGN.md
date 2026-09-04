# DESIGN.md — Kuuku's Odds

Reference direction: **sports media** (Sofascore, Flashscore), chosen over
sportsbook / fintech-dashboard / editorial-photography. Values below were
pulled from those two sites' actual computed styles, not guessed.

## Reference data (source of truth)

**Sofascore** (sofascore.com/football):
- Canvas: `rgb(0,0,0)` — pure black
- Card surface: `rgb(23,28,31)` — charcoal, 16px radius
- Secondary panel: `rgb(17,21,23)`
- Text: `rgb(236,237,239)` — near-white
- Live/urgent accent (semantic only): `rgb(231,59,59)` red
- Font: custom sans with system fallback stack
- Pattern: dense rows grouped under a league header (crest + name), compact
  spacing, no gradients, no glow, no glass effects anywhere.

**Flashscore** (flashscore.com/football):
- Canvas: `rgb(1,10,15)` — near-black navy
- League header bar: `rgb(1,32,62)` — deep navy block
- Brand accent: pink/magenta (logo, active tab, CTA buttons)
- Font: custom sans
- Pattern: same DNA — dense grouped rows, flat color blocks, high
  information density, zero decorative motion.

**Takeaway that changed the plan:** "premium" in this category means
*density and restraint*, not gradients/glow/shimmer. The earlier fintech-
SaaS pass on this site (gradient title text, glow blur, shimmer top bar,
podium glow) is being removed — it doesn't match this reference class and
was reading as generic-AI-premium rather than sports-data-premium.

## Colors (Kuuku's Odds palette)

- `--bg`: `#05070a` — near-black canvas, matches the reference darkness
  without being literally `#000` (keeps card contrast readable)
- `--surface`: `#12161b` — card/row background
- `--surface-alt`: `#171c22` — league group header bar / hover state
- `--border`: `#232830`
- `--text`: `#eef0f2`
- `--text-muted`: `#8b939e`
- `--text-faint`: `#5b636e`
- `--accent`: `#22c98a` — kept from the existing brand mark/favicon/PWA
  icons rather than a full rebrand; green also reads correctly as
  "positive / high probability" in sports data, which is the convention
  both reference sites use their own accent for
- `--accent-strong`: `#14a06a`
- Light mode mirrors the same structure inverted (see `:root` vs
  `prefers-color-scheme`/`[data-theme]` blocks in `index.html`)

## Typography

- Family: Space Grotesk (headings/numbers), Inter (body) — kept, since
  neither reference site's exact custom font is available to us, and this
  pairing already reads as a legitimate sports-data typeface
- Density: sizes and line-heights tightened vs. the previous pass to match
  reference row compactness (rows went from ~14–16px vertical padding to
  ~10–12px)

## Components

- Radius: 12px, one system, applied to cards/rows/avatars-as-circles
  consistently
- Rows: kept as individual ranked rows, NOT grouped by league like the
  references — our product's entire value is cross-league probability
  ranking, so grouping by competition would bury the ranking. Adapted
  instead: each row carries a compact league tag in the `--surface-alt`
  tone, borrowing the references' visual weight for competition identity
  without adopting their chronological/grouped structure.
- Team identity: since real crests aren't licensed for use here, each team
  gets a circular initials badge (2 letters) in a single consistent
  accent-tinted treatment — not per-team random colors, to keep the
  single-accent lock intact. This is the "images" element: visual anchors
  per row without infringing on club branding.
- No gradients on text, no glow/blur decoration, no glass/backdrop-filter,
  no shimmer animation. Motion limited to: row entrance stagger, hover
  lift, tab-indicator slide — same restraint rules as before.

## Notes for future sessions

- If the user asks to "make it pop" again, revisit this file first —
  the reference class explicitly rejects gradient/glow treatments, so
  don't reintroduce them without a deliberate scope change back to a
  different reference direction (fintech-dashboard was the other option
  offered and rejected in favor of this one).
- Logo/favicon/PWA icons were NOT regenerated in this pass — they still
  use the original accent gradient treatment from the fintech-pass
  branding work. That's a deliberately separate asset, not part of the
  in-page redesign.

## Update: hero photography + team badges (deliberate hybrid)

After shipping the restrained sports-media redesign above, the user
explicitly asked for photography/imagery back in, having been told the
tradeoff first. This is a **deliberate, scoped exception**, not a
reversal of the whole direction:

- Added a `.hero` carousel (4 rotating real photos, dot navigation,
  autoplay respecting `prefers-reduced-motion`) at the very top of the
  page only. Everything below it — the dense rows, flat cards, league
  chips, no-gradient rule — is untouched.
- Images are real, verified-generic football photography (empty
  pitches, aerial shots, floodlights) from Unsplash, hotlinked from
  `images.unsplash.com` (free under the Unsplash License). **Every
  candidate image was visually inspected before use** — Unsplash alt
  text is not reliable for this: 3 of the first 4 candidates picked
  by alt-text search turned out to show identifiable real club stadiums
  with visible branding (PSG's "Paris est magique" banner, a Camp
  Nou-style bowl with Nike ads, a Barcelona scoreboard) despite
  generic-sounding alt text like "soccer stadium at night." Always
  open the actual image and look before adding one here.
- Added per-team initials badges (`.team-avatar`, two overlapping
  circles, derived from the fixture string) in every pick row — same
  "no licensed crest art" logic as the league chips, just applied per
  team instead of per competition.

If asked to add more decorative photography elsewhere on the page,
push back gently first — the hero is the one sanctioned exception, and
scattering more photos through the dense list body would undo the
density/restraint that made this redesign work in the first place.

## Update: real crest images (reverses the "no licensed crest art" note above)

The "no licensed crest art" decision above was reversed on the site
owner's explicit request, made *after* being shown TheSportsDB's actual
terms (free tier scoped to "development projects," real trademarked
artwork, no sublicense granted) and choosing to proceed anyway with a
stated intent to go Premium as the site grows. See README's "Team &
league badges" section for the licensing detail — don't re-litigate this
decision without re-reading that first, and don't assume a future
"let's add real logos" request is automatically pre-authorized the same
way; this specific authorization was for this specific source.

Visual result: `.team-avatar` and the league chip both now prefer a real
image (`teamBadges[name]` / `leagueBadges[sportKey]`) and fall back to
the initials/colored-chip treatment when no image is cached yet. The
fallback path is not a design regression to avoid — it's load-bearing:
`scripts/fetch-team-badges.js` builds its cache incrementally (capped
per run, rate-limited), so on any given day some teams legitimately
won't have a real badge yet. Don't try to force 100% image coverage.
