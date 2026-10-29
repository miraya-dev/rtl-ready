---
name: rtl-ready
description: Make a web app ready for right-to-left languages (Arabic, Hebrew, Persian, Urdu). Runs a zero-dependency scanner that lists physical CSS, Tailwind classes and inline styles (ml-, pl-, left-, text-left, margin-left, float, rounded-l…) with file:line and the logical replacement, applies the safe fixes, then handles what a scanner can't — dir/lang per locale, mirroring directional icons (never logos, media controls, checkmarks or clocks), LTR islands for numbers, phones, emails, URLs and code, bidi isolation, Arabic typography, Intl number/date formatting, forms and animations. Use when the user wants to add an RTL language, support RTL, fix a layout that breaks in Arabic or Hebrew, or review i18n/RTL readiness.
license: MIT
---

# rtl-ready

Goal: the app reads naturally right-to-left **and** still works left-to-right. Prefer logical CSS that
works in both directions over `[dir="rtl"]` overrides, and change as little as possible.

## Workflow

1. **Learn the stack.** Framework, styling (Tailwind v3 or v4, CSS modules, CSS-in-JS, Bootstrap), the
   i18n library, and which locales are RTL. If `<html>` doesn't get `dir`/`lang` per locale, read
   [references/i18n-wiring.md](references/i18n-wiring.md) first. Everything else depends on it.
2. **Audit.** Run the scanner on the source folders (not the whole disk):
   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/scan.mjs" src
   ```
   Output is `file:line:col  level  found → replacement  rule`. `fix` = safe drop-in replacement,
   `check` = needs judgment, `tip` = typography/locale advice. Useful flags: `--json`, `--min check`,
   `--ignore <path-part>`, `--tailwind 3|4` (read from package.json by default). Exit code 1 means
   fix/check findings remain.
3. **Apply the safe fixes.** Look over the `fix` list, then run the same command with `--fix` (only
   drop-in replacements are written; checks are never touched). Suggest committing first so the diff
   is easy to review. Prefer hand edits when the user wants a minimal diff in a few files.
4. **Work through every `check`.** Open the reference for its rule:

   | Rules | Read |
   |---|---|
   | `css-rtl-override`, `tw-space-x`, anything about logical properties | [references/logical-css.md](references/logical-css.md) |
   | `icon-mirror`, `arrow-glyph`, `tw-translate`, `css-translate`, `tw-gradient`, `tw-origin` | [references/mirroring.md](references/mirroring.md) |
   | `input-ltr`, `intl-locale`, mixed Arabic/English text | [references/bidi-text.md](references/bidi-text.md) |
   | `letter-spacing`, fonts, line-height | [references/typography.md](references/typography.md) |
   | `html-dir`, `html-lang` | [references/i18n-wiring.md](references/i18n-wiring.md) |

5. **Cover what no scanner sees** (checklist below).
6. **Verify.**
   - Re-run the scan. Every remaining finding must be intentional and carry a
     `rtl-ready-ignore` comment saying why (`rtl-ready-ignore-next-line` on the line before). Wrap a
     block, such as an HTML email template in a string, in `rtl-ready-ignore-start` …
     `rtl-ready-ignore-end` comments.
   - Run the project's tests and build.
   - Look at the UI in both directions: switch to the RTL locale, or set
     `document.documentElement.dir = "rtl"`. If you can take screenshots, compare LTR and RTL.
7. **Report.** Say what changed, what you left physical on purpose and why, and what the user must
   decide (translations, chart direction, brand assets).

## Rules of thumb

- **Logical by default:**
  - Tailwind: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`.
  - CSS: `margin-inline-start`, `inset-inline-end`, `text-align: start`, `float: inline-start`.
  - Flexbox, grid, `gap` and `justify-start` already follow the direction.
- **Never fake RTL** with `flex-row-reverse`, `order`, `space-x-reverse` or by swapping
  `left`/`right` in `[dir=rtl]`. Once the base rule is logical, delete the old overrides.
- **Keep what is symmetric:** `mx-`, `px-`, `inset-x-0`, and centring with
  `left-1/2 -translate-x-1/2` (or `left: 50%` + `translateX(-50%)`).
- **Keep what is physical on purpose:**
  - Something placed by a physical `side`/`placement` prop, such as Radix `data-[side=left]`.
  - Maps, video scrubbers, piano keys and code editors.
  - HTML emails: many email clients ignore logical properties, so use physical properties per direction there
    and put the template between `rtl-ready-ignore-start` and `rtl-ready-ignore-end` comments.
- **Mirror directional icons:** arrows, chevrons, back/next, breadcrumbs, pagination, "send" and
  "reply". In Tailwind that is `rtl:-scale-x-100`.
  - **Never mirror** logos, media controls (play, fast-forward), checkmarks, clocks and refresh
    circles, or icons with text or numbers inside.
- **Use LTR islands** for phone numbers, emails, URLs, code, IBANs, order IDs and math: `dir="ltr"` on
  the element, or `<bdi>` inline. Use `dir="auto"` or `<bdi>` for user content in unknown
  directions.
- **Arabic typography:**
  - Never letter-space Arabic, because its letters join.
  - Use an Arabic-capable font first in the stack for `:lang(ar)`.
  - Use more line-height (body text 1.7–1.9).
  - Don't use faux italics or uppercase styling.
- **Format with `Intl`** in the active locale and never by hand. Choose the digits on purpose,
  because the defaults vary by region and engine (`ar-EG` gives ٠١٢٣, `ar-MA` gives 0–9). Force
  them with `-u-nu-latn` or `-u-nu-arab`.
- **Mirror motion:** drawers, toasts, carousels, progress bars, swipe gestures, ArrowLeft and
  ArrowRight key handling, and `scrollLeft` (it is negative in RTL).

## Checklist (what the scan cannot see)

- [ ] `dir` and `lang` are on `<html>` for every locale and update on a client-side locale switch.
- [ ] Component libraries know the direction: Radix `DirectionProvider`, MUI `direction: "rtl"` with
      stylis-plugin-rtl, Ant Design `ConfigProvider direction`, and carousels with their RTL option.
- [ ] Popovers, tooltips and dropdowns open on the correct side, and placement props are mapped from
      `dir`.
- [ ] Icons drawn as inline `<svg>` or images that point in a direction are mirrored.
- [ ] Mixed strings render correctly: "iPhone 16 Pro", prices, percentages and dates inside Arabic
      sentences. Sentences are not built by string concatenation (use ICU placeholders and plurals;
      Arabic has six plural forms).
- [ ] Inputs: email, phone, URL, code and OTP fields are `dir="ltr"`, and free text is
      `dir="auto"`. Icons inside fields use `start-3` with `ps-10`. Validation messages line up.
- [ ] Charts and timelines follow an explicit choice. Many RTL products keep the time axis
      left-to-right, so ask the user.
- [ ] Fonts: an Arabic, Hebrew, Persian or Urdu font is loaded for that locale, and only for it.
- [ ] Nothing else is cut off or overlaps in RTL, at mobile width too.
