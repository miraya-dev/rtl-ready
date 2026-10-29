# Mirroring icons, motion and visuals

When the page flips, layout follows the direction, but **pictures and motion do not**. An arrow that
means "next" must point left in RTL. A play button must not change.

## Icons: mirror or not?

Mirror an icon when it shows **direction along the reading line**:

- back / forward arrows, and chevrons in breadcrumbs, pagination, carousels and "next" buttons
- disclosure arrows on collapsed tree items or accordions that point sideways
- "send" (paper plane), "reply", "forward", "external link" / "arrow up-right"
- sidebar open/close and indent/outdent icons, and list bullets drawn as arrows
- progress or step indicators that point to the next step

**Never** mirror:

- logos, brand marks, flags, screenshots and photos
- media controls: play, pause, fast-forward, rewind, skip (they show tape direction)
- checkmarks, plus/minus, close (×), search, settings
- clocks, timers, refresh/sync/history circles (clockwise is clockwise everywhere)
- icons with text or digits inside, and real objects (keyboard, headphones, a guitar)

Not sure? Ask whether the icon points to *what comes next in reading order*. If yes, mirror it.

### How

```tsx
<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />          // Tailwind v3.3+ / v4
```

```css
[dir="rtl"] .icon-directional { transform: scaleX(-1); }                  /* any CSS */
.icon-directional:dir(rtl) { transform: scaleX(-1); }                      /* modern browsers */
```

- Put the class on the icon itself, not on a button that also contains text.
- If the icon already has a rotation, combine both in one `transform`. In Tailwind v4,
  `rtl:-scale-x-100` sets the separate `scale` property, so it does not clash with `rotate-*`.
- You can also render a different icon per direction
  (`dir === "rtl" ? <ChevronLeft/> : <ChevronRight/>`), for icons whose details look wrong when flipped.
- Icon fonts need the same flip: Font Awesome `fa-arrow-right`, or Material Symbols `arrow_forward`.
- Unicode arrows `→ ← ⇒` in text **do not** mirror. Use a mirrored icon, or pick the glyph from
  the direction. Brackets, `«»` and `‹›` mirror by themselves (they are Bidi_Mirrored
  characters), so leave those.

## Transforms and animation

Transforms are physical: `translateX(100%)` moves right in both directions.

```html
<!-- off-canvas drawer that slides in from the start side -->
<aside class="fixed inset-y-0 start-0 -translate-x-full rtl:translate-x-full data-[open]:translate-x-0">
```

```css
:root { --dir: 1; }
[dir="rtl"] { --dir: -1; }
.toast { transform: translateX(calc(var(--dir) * 120%)); }
@keyframes slide-in { from { transform: translateX(calc(var(--dir) * -24px)); } }
```

- **JS animation libraries:** pick the sign from the direction, e.g. framer-motion
  `x: dir === "rtl" ? -24 : 24`, and the same in GSAP.
- **Hover nudges:** `group-hover:translate-x-0.5` on an arrow needs an `rtl:` counterpart with the
  opposite sign. The one exception is the optical centring of a play icon, which stays. The scan
  skips it when the tag names a play icon (`PlayIcon`, `Play`, `lucide-play`, `play_arrow`). An
  inline `<svg>` triangle needs a `rtl-ready-ignore` comment.
  The counterpart may carry the same variants after `rtl:` (`rtl:group-hover:-translate-x-0.5`).
- **Centring** with `-translate-x-1/2` plus `left-1/2` is symmetric and stays.
- **transform-origin:** a menu that grows from the top-right corner in LTR should grow from the
  top-left in RTL (`origin-top-right rtl:origin-top-left`).
- **Gradients:** `to right`, shimmer and skeleton sweeps, and progress fills should be mirrored when
  the direction means something (progress, reading motion). Pure decoration can stay.
- **`box-shadow` with a horizontal offset** on a drawer or sticky column: flip it in `[dir=rtl]`.
- **`background-position: left …`**, e.g. an icon painted inside an input: override it in
  `[dir=rtl]`, or better, use a real element placed with `start-3`.

## JavaScript that knows left from right

- **`scrollLeft`:** in RTL it is 0 at the start and goes **negative** toward the end, in all modern
  engines (that is the spec).
  - Use `Math.abs(el.scrollLeft)` for progress.
  - Scroll with `el.scrollBy({ left: dir === "rtl" ? -step : step })`.
  - `scrollIntoView({ inline: "start" })` is already logical.
- **Keyboard:** in a carousel, slider, tabs or menu, ArrowRight means "next" in LTR and "previous" in
  RTL. Map the keys through the direction.
- **Swipe and drag:** the sign of `deltaX` flips. Carousel libraries have an option for this:
  Embla `direction: "rtl"`, Swiper reads the `dir` attribute, Keen Slider `rtl: true`,
  Splide `direction: "rtl"`.
- **Positioning libraries:** Floating UI and Popper placements such as `right-start` are physical.
  Choose the side from the direction, or use a component library that does this for you (Radix
  inside a `DirectionProvider`).
- **`getBoundingClientRect().left`, `offsetLeft` and `clientX`:** check every place that compares x
  positions (tooltips, drag handles, range sliders).
- **Canvas, SVG charts and maps:** `dir` does not mirror them, so decide on purpose. Many RTL
  dashboards keep the time axis left-to-right but put y-axis labels at the start. Ask the user.
