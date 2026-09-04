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
