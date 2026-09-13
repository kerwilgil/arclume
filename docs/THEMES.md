# Themes (Phase 4)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

A theme is a bag of **abstract, renderer-independent tokens**. It carries no
HTML, no CSS, no hex colours, no pixel values. Phase 5 resolves the tokens into a
concrete stylesheet; Phase 4 only decides *which* theme and stamps it.

**Invariant:** a theme never changes content, `knowledgeRefs`, narrative,
provenance or meaning. The same `SlidePlan` under `minimal` and under
`executive` produces the same slides, key messages, blocks, layouts and diagrams
— only `deck.theme` (name + `tokensRef`) differs (enforced by
`tests/visual.themes.test.ts`).

---

## Implemented (**IMPLEMENTED**)

| id | intent |
| --- | --- |
| `minimal` | quiet, editorial, roomy whitespace, hairline borders, outline diagrams, light mode |
| `executive` | confident, high-contrast, raised surfaces, filled diagrams, auto mode |

`corporate`, `technical`, `futuristic` are **PLANNED** — the `ThemeTokens` shape
is ready for them; `getTheme` throws for an unimplemented id and, with context,
`validateArclumeDeck` raises **`deck/theme-unimplemented` (error)** — Phase 5 has
no tokens to resolve for such a deck.

### tokensRef binding (**IMPLEMENTED**)

`deck.theme.tokensRef` is bound to the theme identity: for an implemented theme
it **must** equal `themeTokensRef(getTheme(deck.theme.name))`. With context,
`validateArclumeDeck` raises:

- `deck/theme-tokens-ref-missing` (**error**) — an implemented theme with no `tokensRef`
- `deck/theme-tokens-ref-mismatch` (**error**) — the `tokensRef` is not this theme's token identity (e.g. `name: "minimal"` carrying the executive token id)

This stops Phase 5 from rendering a deck whose declared theme and token identity
disagree.

---

## Token contract (`src/visual/theme.ts`)

```
Theme = {
  id, deckThemeName, mode, aspectRatio, tokens: ThemeTokens
}
ThemeTokens = {
  fontFamilyRole:  "sans" | "serif" | "mono-accent"
  typography:      { display, title, heading, body, caption, metric }   // abstract scale/weight names
  spacingScale:    "compact" | "regular" | "roomy"
  radius:          "none" | "sm" | "md"
  border:          "none" | "hairline" | "solid"
  shadow:          "none" | "soft" | "strong"
  surfaceStyle:    "flat" | "raised"
  color:           ColorRoles                                           // semantic role → token name
  density:         "lean" | "balanced" | "dense"                        // a Phase 5 spacing hint only
  diagramStyle:    "outline" | "soft" | "filled"
}
```

### Colour — semantic roles only (**IMPLEMENTED**)

Values are token *names* (`color.accent`), never literals. One source of truth;
no hex scattered through blocks.

```
background · surface · text-primary · text-secondary · accent
positive · warning · negative · neutral
```

### Typography — hierarchy of intent (**IMPLEMENTED**)

```
display · title · heading · body · caption · metric
```

Each value is an abstract `scale.<size>/<weight>` string. The Phase 5 renderer
resolves the actual font, size and line-height.

---

## What the deck carries

The `ArclumeDeck` IR (Phase 1) only has `theme = { name, aspectRatio, mode,
tokensRef }`. Phase 4 sets:

- `name` — `"minimal"` or `"executive"` (both in the IR enum)
- `tokensRef` — `themeTokensRef(theme)`, a deterministic id derived from the
  resolved token set (`tokens:<id>:<16 hex of contentHash>`). Stable across runs;
  changes only when the tokens change.

The full token table lives in code, not in the deck; Phase 5 looks it up by
`tokensRef`.

> `theme.tokens.density` is a **spacing hint for Phase 5 only**. The per-slide
> block / item budget in Phase 4 comes from the SlidePlan's semantic `density`,
> never from the theme — that is what keeps the two themes semantically
> identical.
