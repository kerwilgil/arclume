# ARCLUME — Brand System

**Status:** FINAL VISUAL IDENTITY  
**Direction:** Concept E — Lume Glyph  
**Tagline:** *Arclume turns complex projects into clear visual narratives.*

## 1. Canonical identity

The official ARCLUME mark is the **Lume Glyph** contained in `master/arclume-symbol.svg`.  
The approved concept presentation is preserved at `reference/concept-e-approved-reference.png` and is the visual reference for implementation.

The mark represents **knowledge becoming visible** through structure, illumination and transformation. Its geometry is intentionally abstract: it can suggest an A, a folded arc, a beam, or a structured aperture without requiring a literal reading.

## 2. Source of truth

- Primary symbol master: `master/arclume-symbol.svg`
- Horizontal logo: `master/arclume-logo-horizontal.svg`
- Wordmark: `master/arclume-wordmark.svg`
- Windows/app icon: `app-icon/arclume-app-icon.svg`
- Favicon: `favicon/favicon.svg`
- Approved visual reference: `reference/concept-e-approved-reference.png`

**SVG is primary. PNG and ICO files are exports.** Do not redraw the logo from screenshots.

## 3. Color system

| Token | Hex | Use |
|---|---|---|
| Graphite | `#0B0F14` | Dark surfaces, dark wordmark |
| Deep Navy | `#07153E` | Gradient depth |
| Lumen Blue | `#3B82F6` | Primary luminous accent |
| Accent Blue | `#2563EB` | Gradient transition |
| Light Blue | `#60A5FA` | Highlight |
| Soft White | `#F8FAFC` | Light surfaces / white logo |
| Cool Gray | `#94A3B8` | Secondary text / neutral |

The brand must remain fully functional in monochrome. The gradient is a digital enhancement, not a requirement for recognition.

## 4. Logo variants

Use the **color mark** on neutral light or dark surfaces. Use `arclume-symbol-black.svg` for one-color light backgrounds and `arclume-symbol-white.svg` on dark backgrounds.

The glow variant under `variants/` is for digital hero art, app icons and social artwork only. It is **not** the master logo.

## 5. Wordmark

The official presentation is uppercase: **ARCLUME**. Letter spacing is deliberately open to create a technical/editorial/architectural tone. The distributed SVG wordmark is converted to vector paths, so it has **no runtime font dependency**.

For editable product typography, use Inter or the platform system sans-serif. No font files are included in this package.

## 6. Clear space

Maintain clear space around the symbol equal to approximately **20% of the symbol width**. For horizontal lockups, keep at least the height of the wordmark's `A` around the complete logo.

## 7. Minimum sizes

- Favicon: purpose-built square treatment down to **16×16 px**.
- Standalone symbol: recommended minimum **24 px** digital.
- Horizontal lockup: recommended minimum width **140 px**.

At very small sizes, use the app/favicon treatment rather than adding the wordmark.

## 8. App and Windows icon

`app-icon/ARCLUME.ico` contains multiple Windows sizes. The icon uses the approved Graphite square with rounded corners and the luminous Lume Glyph. Do not shrink the horizontal logo into an app icon.

## 9. Banners and wallpapers

Social, README and wallpaper compositions use a restrained luminous arc as a secondary brand element. This arc is supporting artwork and **must never replace the Lume Glyph as the logo**.

## 10. Do not

- Do not replace the mark with Concept B / Arc Fold.
- Do not flatten the symbol into a generic letter A.
- Do not use AI sparkles, chat bubbles, brains, neural networks or purple AI gradients.
- Do not stretch, skew, rotate or alter the proportions.
- Do not apply arbitrary shadows or neon effects to the master SVG.
- Do not recreate the wordmark using an arbitrary font. Use the outlined SVG master.
- Do not publish a release, Git tag or npm package as part of brand integration.

## 11. Repository integration target

Recommended destination:

```text
docs/assets/brand/
```

Integrators should copy only the assets required by the target surface and keep this `BRAND.md` available as the implementation contract.

## 12. Package structure

- `master/` — canonical vector marks and lockups
- `variants/` — digital-only glow treatment
- `favicon/` — favicon SVG/PNG/ICO
- `app-icon/` — Windows/application icon assets
- `png/` — high-resolution transparent symbol exports
- `banners/` — README and horizontal artwork
- `wallpapers/` — desktop and mobile wallpaper assets
- `social/` — GitHub social preview
- `reference/` — approved concept board
- `tokens/` — machine-readable color tokens
- `preview/` — final package brand sheet
- `checksums/` — integrity manifest

---

**ARCLUME**  
*Complexity → Structure → Clarity*
