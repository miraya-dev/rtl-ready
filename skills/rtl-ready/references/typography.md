# Typography for Arabic, Hebrew, Persian and Urdu

Latin defaults (tight tracking, uppercase labels, italics, 1.5 line-height, a Latin-only font)
look broken or cheap in Arabic script. Scope the fixes with `:lang()`, so English keeps its look:

```css
:lang(ar), :lang(fa), :lang(ur) {
  letter-spacing: 0;                 /* letters join: spacing tears words apart */
  font-feature-settings: normal;
}
:lang(ar) body, :lang(fa) body { line-height: 1.8; }
:lang(ur) body { line-height: 2.1; } /* Nastaliq is tall */
:lang(ar) :is(h1, h2, h3) { line-height: 1.4; letter-spacing: 0; }
:lang(ar) :is(em, i, cite) { font-style: normal; font-weight: 600; }   /* no true italics */
:lang(ar) .uppercase { text-transform: none; }
```

Tailwind: `rtl:tracking-normal` (or `[&:lang(ar)]:tracking-normal`) next to `tracking-wide`, and
`rtl:leading-relaxed` where needed. `:lang(ar)` matches only when `lang` is set, which is one more
reason to set it on `<html>` (see [i18n-wiring.md](i18n-wiring.md)).

## Rules

- **No letter-spacing on Arabic, Persian or Urdu.** The script is cursive: tracking breaks
  the joins and the ligatures. This includes the "small caps label" style (`uppercase
  tracking-widest text-xs`). Hebrew is not cursive, but wide tracking still reads oddly.
- **Line-height:**
  - Arabic has tall ascenders, dots and marks above and below the letters. Use body text at 1.7–1.9
    and headings at 1.3–1.5.
  - Urdu Nastaliq needs 2 or more.
  - Tight `leading-none` headings clip the marks.
- **Size:** at the same `font-size`, Arabic looks smaller than Latin. Body text often needs one step
  up (16 → 17–18px), and so does small UI text (12px Arabic is hard to read).
- **No faux styles:**
  - There is no true italic in Arabic or Hebrew. The browser slants the glyphs, which looks wrong,
    so use weight or colour for emphasis.
  - `text-transform: uppercase` has no effect on these scripts. Labels designed around it need
    another treatment.
- **Underlines** cross the dots below the letters. Use `text-underline-offset: 0.25em` or
  `text-underline-position: under`.
- **Justified text:** browsers justify Arabic by stretching spaces, not with kashida, so rivers
  appear. Prefer `text-align: start` in UI.
- **Truncation:** `text-overflow: ellipsis` and `line-clamp` work, provided `dir` is correct on the
  element.

## Font stacks

Put the script font first for that language. It usually includes matching Latin glyphs, so mixed
text keeps one look. Then fall back to the Latin brand font and the system fonts.

```css
:root { --font-sans: "Inter", system-ui, sans-serif; }
:lang(ar) { --font-sans: "IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, "Geeza Pro", sans-serif; }
:lang(fa) { --font-sans: "Vazirmatn", "Noto Sans Arabic", Tahoma, sans-serif; }
:lang(ur) { --font-sans: "Noto Nastaliq Urdu", "Noto Naskh Arabic", serif; }
:lang(he) { --font-sans: "Heebo", "Noto Sans Hebrew", "Segoe UI", Arial, sans-serif; }
body { font-family: var(--font-sans); }
```

Good free families (Google Fonts):

| Script | UI / sans | Text / serif-like |
|---|---|---|
| Arabic | IBM Plex Sans Arabic, Noto Sans Arabic, Cairo, Tajawal, Readex Pro, Almarai | Noto Naskh Arabic, Amiri |
| Persian | Vazirmatn | Noto Naskh Arabic |
| Urdu | Noto Nastaliq Urdu (traditional), Noto Naskh Arabic (compact UI) | Gulzar |
| Hebrew | Heebo, Rubik, Assistant, Noto Sans Hebrew | Frank Ruhl Libre, David Libre |

- Load only the subsets you need (`subsets: ["arabic"]` in `next/font`, or `&subset=arabic`).
  Load the Arabic font only on Arabic pages, or with `unicode-range`, so English pages don't pay
  for it.
- Check the weights: many Arabic families ship fewer of them. A missing weight gets synthesised
  as faux bold.
- Make sure digits match the font's style. Some Arabic fonts draw 0–9 in a different style; test
  your price and table views.

```ts
// next/font
import { IBM_Plex_Sans_Arabic } from "next/font/google"
export const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "700"], variable: "--font-arabic" })
```
