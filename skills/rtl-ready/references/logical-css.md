# Logical CSS and Tailwind

Physical properties (`left`, `margin-right`) stay where they are when the page flips. Logical
properties (`inset-inline-start`, `margin-inline-end`) follow the writing direction, so one rule
works in LTR and RTL. They are supported in every evergreen browser; `float`/`clear: inline-start`
landed last (Chrome 118, late 2023).

## CSS

| Physical | Logical |
|---|---|
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `left` / `right` | `inset-inline-start` / `inset-inline-end` |
| `border-left` (`-width`, `-style`, `-color`) | `border-inline-start` (`-width`, …) |
| `border-top-left-radius` | `border-start-start-radius` |
| `border-top-right-radius` | `border-start-end-radius` |
| `border-bottom-left-radius` | `border-end-start-radius` |
| `border-bottom-right-radius` | `border-end-end-radius` |
| `text-align: left` / `right` | `text-align: start` / `end` |
| `float: left` / `right` | `float: inline-start` / `inline-end` |
| `clear: left` / `right` | `clear: inline-start` / `inline-end` |
| `scroll-margin-left`, `scroll-padding-left` | `scroll-margin-inline-start`, `scroll-padding-inline-start` |
| `margin: 0 8px 0 0` | `margin-block: 0; margin-inline: 0 8px` (inline = start end) |
| `border-radius: 8px 0 0 8px` | `border-start-start-radius: 8px; border-end-start-radius: 8px` (others 0) |

Vertical properties (`top`, `bottom`, `margin-top`) are fine as they are, and so are `width`/`height`.

React/JS style objects use the camelCase names: `marginInlineStart`, `paddingInlineEnd`,
`insetInlineStart`, `borderStartStartRadius`, `textAlign: "start"`, `float: "inline-start"`.

There is no logical `background-position`, `box-shadow` offset or `transform`. See
[mirroring.md](mirroring.md).

## Tailwind

| Physical | Logical | Since |
|---|---|---|
| `ml-*` / `mr-*` | `ms-*` / `me-*` | v3.3 |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` | v3.3 |
| `left-*` / `right-*` | `start-*` / `end-*` (newer v4 also has `inset-s-*` / `inset-e-*`) | v3.3 |
| `text-left` / `text-right` | `text-start` / `text-end` | v3.0 |
| `border-l*` / `border-r*` | `border-s*` / `border-e*` | v3.3 |
| `rounded-l*` / `rounded-r*` | `rounded-s*` / `rounded-e*` | v3.3 |
| `rounded-tl/tr/bl/br*` | `rounded-ss/se/es/ee*` | v3.3 |
| `scroll-ml/mr/pl/pr-*` | `scroll-ms/me/ps/pe-*` | v3.3 |
| `float-left/right`, `clear-left/right` | `float-start/end`, `clear-start/end` (older: `[float:inline-start]`) | v4 |
| `space-x-*` | `gap-x-*` on the flex/grid parent | any |

- `space-x-*` and `divide-x-*` use physical margins/borders in **v3** and logical ones in **v4**.
  On v3 people add `rtl:space-x-reverse`; after upgrading to v4 that flips twice. Use `gap-x-*`.
- The `rtl:` and `ltr:` variants exist since v3.3. Use them only for what has no logical form
  (transforms, gradients, origins, icon mirroring), never as `ltr:ml-2 rtl:mr-2`, which is just `ms-2`.
- In v4 the `rtl:` variant matches `[dir="rtl"]` on the element or any ancestor, and `:dir(rtl)`.
- Arbitrary values follow the same mapping: `ml-[13px]` → `ms-[13px]`.

## Bootstrap

Bootstrap 5 renamed its utilities:
- `ms-*`/`me-*` and `ps-*`/`pe-*`
- `text-start`/`text-end` and `float-start`/`float-end`
- `start-0`/`end-0`, `border-start`/`border-end` and `rounded-start`/`rounded-end`
- `dropdown-menu-end`

In Bootstrap 5 these compile to **physical** CSS, so RTL pages must load `bootstrap.rtl.min.css`
instead of `bootstrap.min.css`. The scan flags the Bootstrap 3/4 names (`pull-right`, `ml-3`,
`rounded-left`).

## Leave these alone

- **Symmetric values:** `mx-*`, `px-*`, `inset-x-0`, `margin: 0 auto`, `left: 0; right: 0`.
- **Centring:** `left-1/2 -translate-x-1/2` and `left: 50%; transform: translateX(-50%)` are
  symmetric. Converting only the `left` breaks the centring in RTL, because the element shifts by
  half its width. The scan skips these pairs.
- **Things that really are physical:**
  - a map pin, a video scrubber, a piano keyboard, a code editor gutter
  - a side chosen by a `side="left"` prop (Radix `data-[side=left]:…`, which the scan skips)
- **HTML email:** Gmail, Outlook and others ignore many logical properties. Keep physical
  properties there, set `dir="rtl"` on the email body and swap sides per direction.

## Old-school overrides

```css
.card { margin-left: 16px; }
[dir="rtl"] .card { margin-left: 0; margin-right: 16px; }   /* override */
```

Convert the base rule to `margin-inline-start: 16px` and **delete** the override. Converting the
override too would give `margin-inline-start: 0; margin-inline-end: 16px` in RTL, which is the
wrong side. The scan reports these as `css-rtl-override` instead of fixing them.

RTLCSS-generated `*.rtl.css` files are the same: once the source is logical, drop the RTLCSS step.

## Silencing a finding

Add a comment containing one of these, and say why:
- `rtl-ready-ignore` on the same line
- `rtl-ready-ignore-next-line` on the line before
- `rtl-ready-ignore-start` … `rtl-ready-ignore-end` around a block, such as an HTML email template
  inside a string (a block without an end runs to the end of the file)
- `rtl-ready-ignore-file` anywhere in the file

```tsx
{/* rtl-ready-ignore-next-line: the scrubber is physical, like the video */}
<div className="absolute left-0 h-1 bg-primary" style={{ width: `${progress}%` }} />
```
