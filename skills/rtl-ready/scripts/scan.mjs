#!/usr/bin/env node
/**
 * rtl-ready scan: finds code that breaks when a page is right-to-left (Arabic, Hebrew,
 * Persian, Urdu) and suggests the logical replacement. Zero dependencies, Node 18+.
 *
 *   node scan.mjs [paths…] [--json] [--fix] [--min fix|check|tip] [--ignore <text>]…
 *                 [--tailwind 3|4] [--exit-zero]
 *
 * Severities: "error" (shown as fix)   a safe drop-in replacement, applied by --fix
 *             "warn"  (shown as check) needs a human look (icons, transforms, inputs, dir/lang)
 *             "info"  (shown as tip)   typography and locale advice
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const VERSION = "0.1.0"

const LABEL = { error: "fix", warn: "check", info: "tip" }
const RANK = { info: 1, warn: 2, error: 3 }

export const CSS_EXT = new Set([".css", ".scss", ".sass", ".less", ".pcss", ".postcss"])
export const MARKUP_EXT = new Set([
  ".html", ".htm", ".vue", ".svelte", ".astro", ".php", ".erb", ".hbs", ".handlebars",
  ".njk", ".liquid", ".twig", ".ejs", ".cshtml", ".razor",
])
export const JS_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"])
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", ".next", ".nuxt", ".svelte-kit", ".output", ".vercel",
  ".netlify", ".turbo", ".cache", ".parcel-cache", ".angular", "dist", "build", "out",
  "coverage", "vendor", "storybook-static", "__snapshots__",
])
const MAX_BYTES = 1_000_000

const LR = { left: "start", right: "end" }
const SIDE = { l: "s", r: "e" }
const CORNER = { l: "s", r: "e", tl: "ss", tr: "se", bl: "es", br: "ee" }
const FLIP = {
  l: "r", r: "l", tl: "tr", tr: "tl", bl: "br", br: "bl", left: "right", right: "left",
  "top-left": "top-right", "top-right": "top-left", "bottom-left": "bottom-right", "bottom-right": "bottom-left",
}

// ─── Tailwind / class tokens ────────────────────────────────────────────────────────────────
// A class token starts after whitespace, a quote, `{`, `(`, `,`, `>`, `|` or `=`, may carry
// variants (`md:`, `hover:`, `data-[x]:`, `[&_svg]:`), an important flag and a minus sign.
const START = String.raw`(?<=^|[\s"'\`{(,>|=])`
const END = String.raw`(?=$|[\s"'\`}),<>|;])`
const VARIANT_CHAIN = String.raw`(?:[\w*@-]*(?:\[[^\]\s]*\])?(?:\/[\w-]+)?:)*`
const VARIANTS = `(?<variants>${VARIANT_CHAIN})`
const VAL = String.raw`(?:\d+(?:\.\d+)?|\d+\/\d+|px|auto|full|\[[^\]\s]+\]|\([^)\s]+\))`
const DIR_VARIANT = /(?:^|:)(?:rtl|ltr):|dir[=\]]/
// data-[side=left]:left-0 (Radix/shadcn) follows a physical side on purpose
const SIDE_VARIANT = /\b(?:left|right)\b/
// A mirrored counterpart on the same line, with or without more variants after rtl:
// (rtl:-translate-x-1, rtl:group-hover:-translate-x-1).
const counterpart = (util, dirs = "rtl|ltr") => new RegExp(String.raw`(?:${dirs}):${VARIANT_CHAIN}!?-?${util}`)
const MIRRORED_TRANSLATE = counterpart("translate-x-")
const MIRRORED_GRADIENT = counterpart("bg-", "rtl")
const MIRRORED_ORIGIN = counterpart("origin-", "rtl")
// translate-x-0.5 on a play icon is optical centring of the triangle: media controls never mirror.
const PLAY_ICON = /^<(?:\w+\.)*Play(?:Icon)?(?![\w.])|(?<![\w-])lucide-play(?![\w-])|(?<![\w-])play_arrow(?![\w-])/

const cls = (id, severity, util, extra = {}) => ({
  id,
  severity,
  re: new RegExp(`${START}${VARIANTS}(?<imp>!?)(?<neg>-?)${util}(?<imp2>!?)${END}`, "gm"),
  ...extra,
})
const wrap = (g, util) => `${g.variants}${g.imp}${g.neg}${util}${g.imp2}`

function classRules(tailwind) {
  const rules = [
    cls("tw-physical", "error", String.raw`(?<base>scroll-m|scroll-p|m|p)(?<side>[lr])-(?<val>${VAL})`, {
      fix: (g) => wrap(g, `${g.base}${SIDE[g.side]}-${g.val}`),
    }),
    cls("tw-physical", "error", String.raw`(?<side>left|right)-(?<val>${VAL})`, {
      fix: (g) => wrap(g, `${LR[g.side]}-${g.val}`),
      // left-1/2 + -translate-x-1/2 centres the element: symmetric, keep it physical.
      skip: (g, line) => g.val === "1/2" && /-translate-x-1\/2/.test(line),
    }),
    cls("tw-physical", "error", String.raw`(?<base>text|float|clear)-(?<side>left|right)`, {
      fix: (g) => wrap(g, `${g.base}-${LR[g.side]}`),
    }),
    cls("tw-physical", "error", String.raw`border-(?<side>[lr])(?<rest>-[\w.\[\]()#%/-]+)?`, {
      fix: (g) => wrap(g, `border-${SIDE[g.side]}${g.rest ?? ""}`),
    }),
    cls(
      "tw-physical",
      "error",
      String.raw`rounded-(?<corner>tl|tr|bl|br|l|r)(?<rest>-(?:none|xs|sm|md|lg|xl|[2-4]xl|full|\[[^\]\s]+\]|\([^)\s]+\)))?`,
      { fix: (g) => wrap(g, `rounded-${CORNER[g.corner]}${g.rest ?? ""}`) },
    ),
    cls("tw-space-x", "warn", String.raw`space-x-reverse`, {
      dirVariants: true,
      hint: "space-x-reverse is usually an RTL workaround; Tailwind v4 space-x is already logical, so it flips twice. Prefer gap-x-* on a flex/grid parent",
    }),
    cls("tw-translate", "warn", String.raw`translate-x-(?<val>${VAL})`, {
      skip: (g, line, text, i) =>
        MIRRORED_TRANSLATE.test(line) ||
        (g.val === "1/2" && g.neg && /left-1\/2/.test(line)) ||
        PLAY_ICON.test(elementAt(text, i)),
      fix: (g, found) => {
        const negative = Boolean(g.neg) !== g.val.startsWith("[-")
        const size = g.val.startsWith("[-") ? `[${g.val.slice(2)}` : g.val
        return `${found} ${g.variants}rtl:${negative ? "" : "-"}translate-x-${size}`
      },
      hint: "transforms do not flip in RTL; mirror horizontal movement",
    }),
    cls("tw-gradient", "warn", String.raw`bg-(?<kind>gradient|linear)-to-(?<dir>tl|tr|bl|br|l|r)`, {
      skip: (g, line) => MIRRORED_GRADIENT.test(line),
      fix: (g, found) => `${found} ${g.variants}rtl:bg-${g.kind}-to-${FLIP[g.dir]}`,
      hint: "gradient direction does not flip; mirror it when the direction means something",
    }),
    cls("tw-origin", "warn", String.raw`origin-(?<dir>top-left|top-right|bottom-left|bottom-right|left|right)`, {
      skip: (g, line) => MIRRORED_ORIGIN.test(line),
      fix: (g, found) => `${found} ${g.variants}rtl:origin-${FLIP[g.dir]}`,
      hint: "transform-origin does not flip; a menu anchored at the end grows from the other corner in RTL",
    }),
    cls("letter-spacing", "info", String.raw`tracking-(?<val>tighter|tight|wide|wider|widest|\[[^\]\s]+\]|\([^)\s]+\))`, {
      skip: (g, line) => /rtl:tracking-|lang\(ar\)|ar:tracking-/.test(line),
      hint: "Arabic letters join, so letter-spacing breaks them; reset it for Arabic (rtl:tracking-normal or :lang(ar) { letter-spacing: 0 })",
    }),
  ]
  if (tailwind === 3) {
    rules.push(
      cls("tw-space-x", "warn", String.raw`space-x-(?<val>${VAL})`, {
        hint: "Tailwind v3 space-x uses margin-left/right; use gap-x-* on a flex/grid parent",
      }),
    )
  }
  return rules
}

const BOOTSTRAP_RULES = [
  cls("bs-physical", "error", String.raw`(?<base>rounded|border)-(?<side>left|right)(?<rest>-[\w-]+)?`, {
    fix: (g) => wrap(g, `${g.base}-${LR[g.side]}${g.rest ?? ""}`),
  }),
  cls("bs-physical", "error", String.raw`pull-(?<side>left|right)`, {
    fix: (g) => wrap(g, `float-${LR[g.side]}`),
  }),
]

function scanClasses(text, base, out, opts, { bootstrap }) {
  const rules = bootstrap ? [...classRules(opts.tailwind), ...BOOTSTRAP_RULES] : classRules(opts.tailwind)
  for (const rule of rules) {
    for (const m of text.matchAll(rule.re)) {
      const g = m.groups
      if (!rule.dirVariants && (DIR_VARIANT.test(g.variants) || SIDE_VARIANT.test(g.variants))) continue
      const line = lineAround(text, m.index)
      if (rule.skip?.(g, line, text, m.index)) continue
      push(out, rule, base + m.index, m[0], rule.fix ? rule.fix(g, m[0]) : null)
    }
  }
}

// ─── CSS ────────────────────────────────────────────────────────────────────────────────────
const CSS_RULES = [
  {
    re: /(?<![\w$@-])(?<p>(?:scroll-)?(?:margin|padding))-(?<side>left|right)(?=\s*:)/g,
    fix: (g) => `${g.p}-inline-${LR[g.side]}`,
  },
  {
    re: /(?<![\w$@-])border-(?<side>left|right)(?<sub>-(?:width|style|color))?(?=\s*:)/g,
    fix: (g) => `border-inline-${LR[g.side]}${g.sub ?? ""}`,
  },
  {
    re: /(?<![\w$@-])border-(?<v>top|bottom)-(?<h>left|right)-radius(?=\s*:)/g,
    fix: (g) => `border-${g.v === "top" ? "start" : "end"}-${LR[g.h]}-radius`,
  },
  {
    re: /(?<![\w$@-])(?<p>text-align|float|clear)(?<sep>\s*:\s*)(?<side>left|right)(?![\w-])/g,
    fix: (g) => `${g.p}${g.sep}${g.p === "text-align" ? "" : "inline-"}${LR[g.side]}`,
  },
]
// margin: 0 8px 0 0 and border-radius: 8px 0 0 8px are physical too (top right bottom left).
const CSS_SHORTHAND = /(?<![\w$@-])(?<p>margin|padding|inset|border-radius)\s*:\s*(?<v>[^;{}!\n]+?)\s*(?=;|}|$)/gm
const CSS_INSET = /(?<=^|[\s;{])(?<side>left|right)(?=\s*:)/gm
const JS_CSS_INSET = /(?<=^|[\s;{`])(?<side>left|right)(?=\s*:\s*(?:-?[\d.]+[a-z%]*|auto|calc\(|var\(|\$\{|inherit|initial|unset)[^;'"\n{},]*;)/gm
const CSS_TRANSLATE = /translate(?:X|3d)?\((?!\s*0(?:px|%|r?em)?\s*[,)])\s*[^,)]+/g
const CSS_LETTER_SPACING =
  /(?<![\w$@-])letter-spacing\s*:(?!\s*(?:0(?:\.0+)?[a-z%]*|normal|inherit|initial|unset|revert)\s*(?:[;}!]|$))\s*[^;}\n]+/gm
const OVERRIDE_SELECTOR = /\[dir|:dir\(|[.#_-]rtl\b|[.#_-]ltr\b|\brtl[-_]|:lang\(/
// translateX(calc(var(--dir) * 120%)) already follows the direction
const DIR_VAR = /var\(\s*--[\w-]*(?:dir|rtl|flip|sign)/i

const cssRule = { id: "css-physical", severity: "error" }
const overrideRule = {
  id: "css-rtl-override",
  severity: "warn",
  hint: "direction-specific override: once the base rule uses logical properties, delete this override",
}
const translateRule = {
  id: "css-translate",
  severity: "warn",
  hint: "transforms do not flip in RTL; mirror horizontal movement in a [dir=\"rtl\"] rule (centring with -50% is fine)",
}
const letterRule = {
  id: "letter-spacing",
  severity: "info",
  hint: "Arabic letters join, so letter-spacing breaks them; add :lang(ar) { letter-spacing: 0 }",
}

/** The selector and declaration body around `i` (inline styles have no braces: body is everything). */
function blockAt(css, i) {
  const open = css.lastIndexOf("{", i)
  if (open === -1) return { selector: "", body: css }
  const close = css.indexOf("}", i)
  return { selector: css.slice(css.lastIndexOf("}", open) + 1, open), body: css.slice(open + 1, close === -1 ? undefined : close) }
}
const isCentred = (body) => /(?:^|[\s;{])(?:left|right)\s*:\s*50%/.test(body) && /translate(?:X|3d)?\(\s*-50%/.test(body)

/** Splits a CSS value on top-level whitespace (keeps calc(1rem + 2px) together). */
function splitValues(v) {
  const out = []
  let depth = 0
  let cur = ""
  for (const ch of v) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** The logical form of an asymmetric margin/padding/inset/border-radius shorthand, or null. */
function logicalShorthand(p, v) {
  if (v.includes("/")) return null
  const t = splitValues(v)
  if (p === "border-radius") {
    const [tl, tr = tl, br = tl, bl = tr] = t
    if (t.length > 4 || (tl === tr && bl === br)) return null
    return `border-start-start-radius: ${tl}; border-start-end-radius: ${tr}; border-end-end-radius: ${br}; border-end-start-radius: ${bl}`
  }
  if (t.length !== 4 || t[1] === t[3]) return null
  return `${p}-block: ${t[0] === t[2] ? t[0] : `${t[0]} ${t[2]}`}; ${p}-inline: ${t[3]} ${t[1]}`
}

function scanCss(css, base, out, opts, { inJs = false } = {}) {
  const physical = (m, replace) => {
    const { selector } = blockAt(css, m.index)
    if (OVERRIDE_SELECTOR.test(selector)) push(out, overrideRule, base + m.index, m[0], null)
    else push(out, cssRule, base + m.index, m[0], replace)
  }
  for (const rule of CSS_RULES) for (const m of css.matchAll(rule.re)) physical(m, rule.fix(m.groups))
  for (const m of css.matchAll(inJs ? JS_CSS_INSET : CSS_INSET)) {
    if (isCentred(blockAt(css, m.index).body)) continue
    physical(m, `inset-inline-${LR[m.groups.side]}`)
  }
  if (inJs) return
  for (const m of css.matchAll(CSS_SHORTHAND)) {
    const replace = logicalShorthand(m.groups.p, m.groups.v)
    if (!replace) continue
    const found = m[0].trimEnd()
    if (OVERRIDE_SELECTOR.test(blockAt(css, m.index).selector)) push(out, overrideRule, base + m.index, found, null)
    else push(out, cssRule, base + m.index, found, replace)
  }
  for (const m of css.matchAll(CSS_TRANSLATE)) {
    const { selector, body } = blockAt(css, m.index)
    if (OVERRIDE_SELECTOR.test(selector) || isCentred(body) || DIR_VAR.test(m[0])) continue
    push(out, translateRule, base + m.index, m[0] + ")", null)
  }
  for (const m of css.matchAll(CSS_LETTER_SPACING)) {
    if (OVERRIDE_SELECTOR.test(blockAt(css, m.index).selector)) continue
    push(out, letterRule, base + m.index, m[0].trim(), null)
  }
  for (const m of css.matchAll(/@apply\s+([^;{}]+)/g)) {
    scanClasses(m[1], base + m.index + m[0].length - m[1].length, out, opts, { bootstrap: false })
  }
}

// ─── JS style objects (React style={{…}}, Vue :style, CSS-in-JS objects) ──────────────────────
const JS_PROPS = {
  marginLeft: "marginInlineStart", marginRight: "marginInlineEnd",
  paddingLeft: "paddingInlineStart", paddingRight: "paddingInlineEnd",
  borderLeft: "borderInlineStart", borderRight: "borderInlineEnd",
  borderLeftWidth: "borderInlineStartWidth", borderRightWidth: "borderInlineEndWidth",
  borderLeftColor: "borderInlineStartColor", borderRightColor: "borderInlineEndColor",
  borderLeftStyle: "borderInlineStartStyle", borderRightStyle: "borderInlineEndStyle",
  borderTopLeftRadius: "borderStartStartRadius", borderTopRightRadius: "borderStartEndRadius",
  borderBottomLeftRadius: "borderEndStartRadius", borderBottomRightRadius: "borderEndEndRadius",
  scrollMarginLeft: "scrollMarginInlineStart", scrollMarginRight: "scrollMarginInlineEnd",
  scrollPaddingLeft: "scrollPaddingInlineStart", scrollPaddingRight: "scrollPaddingInlineEnd",
}
const JS_PROP_RE = new RegExp(String.raw`(?<![\w$.])(?<prop>${Object.keys(JS_PROPS).join("|")})(?![\w$])(?=["']?\s*:)`, "g")
const JS_TEXT_ALIGN = /(?<![\w$.])textAlign(?<sep>["']?\s*:\s*)(?<q>["'`])(?<side>left|right)\k<q>/g
const JS_FLOAT = /(?<![\w$.])(?<p>cssFloat|float)(?<sep>["']?\s*:\s*)(?<q>["'`])(?<side>left|right)\k<q>/g
const JS_INSET_KEY = /(?<![\w$.-])(?<side>left|right)(?=["']?\s*:)/g
const STYLE_LINE = /\b(?:style|sx)\s*=\s*\{\{|\bstyle\s*:\s*\{|:style\s*=\s*["']/
const jsRule = { id: "js-style", severity: "error" }

function scanJsStyles(text, out) {
  for (const m of text.matchAll(JS_PROP_RE)) push(out, jsRule, m.index, m[0], JS_PROPS[m.groups.prop])
  for (const m of text.matchAll(JS_TEXT_ALIGN)) {
    const { sep, q, side } = m.groups
    push(out, jsRule, m.index, m[0], `textAlign${sep}${q}${LR[side]}${q}`)
  }
  for (const m of text.matchAll(JS_FLOAT)) {
    const { p, sep, q, side } = m.groups
    push(out, jsRule, m.index, m[0], `${p}${sep}${q}inline-${LR[side]}${q}`)
  }
  for (const m of text.matchAll(JS_INSET_KEY)) {
    if (!STYLE_LINE.test(lineAround(text, m.index))) continue
    push(out, jsRule, m.index, m[0], m.groups.side === "left" ? "insetInlineStart" : "insetInlineEnd")
  }
}

// ─── Markup: <html dir/lang>, LTR inputs, directional icons and arrows ───────────────────────
const HTML_TAG = /<(?:html|Html)\b(?<attrs>(?:=>|[^>])*)>/g
const INPUT_TAG = /<(?:input|Input|TextField|TextInput)\b(?<attrs>(?:=>|[^>])*)>/g
const COMPONENT_TAG = /<(?<name>[A-Z][\w.]*)\b(?<attrs>(?:=>|[^>])*)>/g
const ICON_NAME = /(?:Arrow|Chevron|Caret|Angle|Navigate)/
const ICON_DIRECTION = /(?:Left|Right|Back|Forward|Next|Prev|Before)/
const ICON_FONT =
  /(?<![\w-])(?:fa|fas|far|bi|ti|ri|mdi|la|las|icon|glyphicon)-[\w-]*?(?:arrow|chevron|caret|angle)[\w-]*?(?:left|right)(?:-[\w-]+)?(?![\w-])/g
const MATERIAL_LIGATURE =
  />\s*(?<lig>arrow_back(?:_ios(?:_new)?)?|arrow_forward(?:_ios)?|chevron_left|chevron_right|navigate_next|navigate_before|keyboard_arrow_left|keyboard_arrow_right|first_page|last_page)\s*</g
const MIRRORED = /rtl:|scale-x|flip|mirror|rotate-180/
const ARROW_GLYPH = /[→←⟶⟵➜➔➝⇒⇐⇢⇠]|&(?:rarr|larr|rArr|lArr|longrightarrow|longleftarrow);/g
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|#|\{\/\*)/

const dirRule = { id: "html-dir", severity: "warn" }
const langRule = { id: "html-lang", severity: "warn" }
const inputRule = {
  id: "input-ltr",
  severity: "warn",
  hint: "emails, phone numbers and URLs are LTR: add dir=\"ltr\" (and rtl:text-right to line up with the other fields)",
}
const iconRule = {
  id: "icon-mirror",
  severity: "warn",
  hint: "directional icon: mirror it in RTL (className=\"rtl:-scale-x-100\")",
}
const arrowRule = {
  id: "arrow-glyph",
  severity: "warn",
  hint: "arrow characters do not mirror in RTL; use a mirrored icon or choose the glyph from the direction",
}
const excerpt = (tag) => {
  const flat = tag.replace(/\s+/g, " ")
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat
}
const inComment = (text, i) => COMMENT_LINE.test(lineAround(text, i))
const hasAttr = (attrs, name) => new RegExp(String.raw`(?<![\w:-])(?::|v-bind:)?${name}\s*=`).test(attrs)

function scanMarkup(text, out) {
  for (const m of text.matchAll(HTML_TAG)) {
    if (inComment(text, m.index)) continue
    const { attrs } = m.groups
    const found = excerpt(m[0])
    if (!hasAttr(attrs, "lang")) push(out, { ...langRule, hint: "no lang: set it per locale (screen readers, fonts and hyphenation depend on it)" }, m.index, found, null)
    if (!hasAttr(attrs, "dir")) push(out, { ...dirRule, hint: "no dir: set it per locale, dir=\"rtl\" for ar, he, fa, ur" }, m.index, found, null)
    else if (/(?<![\w:-])dir\s*=\s*["']ltr["']/.test(attrs)) {
      push(out, { ...dirRule, severity: "info", hint: "dir is hard-coded to ltr: derive it from the active locale" }, m.index, found, null)
    }
  }
  for (const m of text.matchAll(INPUT_TAG)) {
    const { attrs } = m.groups
    if (!/(?<![\w-])type\s*=\s*\{?\s*["'`](?:email|tel|url)["'`]/.test(attrs) || hasAttr(attrs, "dir")) continue
    if (inComment(text, m.index)) continue
    push(out, inputRule, m.index, excerpt(m[0]), null)
  }
  for (const m of text.matchAll(COMPONENT_TAG)) {
    const { name, attrs } = m.groups
    if (!ICON_NAME.test(name) || !ICON_DIRECTION.test(name) || /LeftRight|RightLeft/.test(name)) continue
    if (MIRRORED.test(attrs) || inComment(text, m.index)) continue
    push(out, iconRule, m.index, `<${name}>`, null)
  }
  for (const m of text.matchAll(ICON_FONT)) {
    if (/left-right|right-left/.test(m[0]) || MIRRORED.test(quotedAround(text, m.index))) continue
    push(out, iconRule, m.index, m[0], null)
  }
  for (const m of text.matchAll(MATERIAL_LIGATURE)) {
    if (MIRRORED.test(openingTag(text, m.index + 1))) continue
    push(out, iconRule, m.index + m[0].indexOf(m.groups.lig), m.groups.lig, null)
  }
  for (const m of text.matchAll(ARROW_GLYPH)) {
    const line = lineAround(text, m.index)
    if (COMMENT_LINE.test(line) || MIRRORED.test(openingTag(text, m.index))) continue
    push(out, arrowRule, m.index, m[0], null)
  }
}

// ─── Locale formatting ──────────────────────────────────────────────────────────────────────
const INTL_EMPTY = /\.toLocale(?:Date|Time)?String\(\s*\)/g
const INTL_EN = /(?:toLocale(?:Date|Time)?String|Intl\.\w+)\(\s*(["'`])en(?:-[A-Za-z]{2})?\1/g
const intlRule = { id: "intl-locale", severity: "info" }

function scanIntl(text, out) {
  for (const m of text.matchAll(INTL_EMPTY)) {
    push(out, { ...intlRule, hint: "pass the active locale so digits, separators and dates follow it" }, m.index, m[0], null)
  }
  for (const m of text.matchAll(INTL_EN)) {
    push(out, { ...intlRule, hint: "hard-coded English locale: pass the active locale instead" }, m.index, m[0], null)
  }
}

// ─── Plumbing ───────────────────────────────────────────────────────────────────────────────
function push(out, rule, index, found, replace) {
  out.push({ rule: rule.id, severity: rule.severity, index, found, replace: replace ?? null, hint: rule.hint ?? null })
}

function lineAround(text, i) {
  const s = text.lastIndexOf("\n", i - 1) + 1
  const e = text.indexOf("\n", i)
  return text.slice(s, e === -1 ? undefined : e)
}

/** The quoted string (class list) that contains `i`, or "" when `i` is not inside quotes on its line. */
function quotedAround(text, i) {
  const line = lineAround(text, i)
  const at = i - (text.lastIndexOf("\n", i - 1) + 1)
  const open = Math.max(line.lastIndexOf('"', at), line.lastIndexOf("'", at), line.lastIndexOf("`", at))
  if (open === -1) return ""
  const close = line.indexOf(line[open], at)
  return line.slice(open + 1, close === -1 ? undefined : close)
}

/** The opening tag just before `i` (`<span class="…">` for text inside that span). */
function openingTag(text, i) {
  const lt = text.lastIndexOf("<", i)
  return lt === -1 ? "" : text.slice(lt, i)
}

/**
 * The whole tag that contains `i` plus the text right after it (`<span class="…">play_arrow`),
 * or "" when `i` is not inside a tag. Skips `>` inside quotes and `{…}` (`=>`, `[&>svg]:`).
 */
function elementAt(text, i) {
  let lt = text.lastIndexOf("<", i)
  while (lt > -1 && !/[A-Za-z]/.test(text.charAt(lt + 1))) lt = lt ? text.lastIndexOf("<", lt - 1) : -1
  if (lt === -1) return ""
  let quote = ""
  let depth = 0
  for (let j = lt + 1; j < text.length; j++) {
    const ch = text[j]
    if (quote) {
      if (ch === quote) quote = ""
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === ">" && depth <= 0) {
      if (j < i) return ""
      const next = text.indexOf("<", j)
      return text.slice(lt, next === -1 ? undefined : next)
    }
  }
  return ""
}

/** Replaces every match with spaces, keeping newlines so offsets and line numbers stay valid. */
function blank(text, re) {
  return text.replace(re, (m) => m.replace(/[^\n]/g, " "))
}
function blankCssComments(css, ext) {
  const out = blank(css, /\/\*[\s\S]*?\*\//g)
  return ext === ".css" || ext === ".pcss" || ext === ".postcss" ? out : blank(out, /(?<![:"'])\/\/[^\n]*/g)
}

/** 1-based lines silenced by comments. A block runs from -start to -end (or the end of the file). */
function ignoredLines(text) {
  const ignored = new Set()
  let block = false
  text.split("\n").forEach((line, i) => {
    if (line.includes("rtl-ready-ignore-start")) block = true
    if (block) ignored.add(i + 1)
    if (line.includes("rtl-ready-ignore-end")) block = false
    if (line.includes("rtl-ready-ignore-next-line")) ignored.add(i + 2)
    else if (line.includes("rtl-ready-ignore")) ignored.add(i + 1)
  })
  return ignored
}

/**
 * Scans one file's text. `file` only decides the language (by extension).
 * Returns findings with 1-based `line`/`column` plus the character `index` used by --fix.
 */
export function scanText(text, file = "file.html", { tailwind = 4 } = {}) {
  if (text.includes("rtl-ready-ignore-file")) return []
  const ext = extname(file).toLowerCase()
  const opts = { tailwind }
  const raw = []
  if (CSS_EXT.has(ext)) {
    scanCss(blankCssComments(text, ext), 0, raw, opts)
  } else if (MARKUP_EXT.has(ext) || JS_EXT.has(ext)) {
    const markup = MARKUP_EXT.has(ext)
    let body = markup ? blank(text, /<!--[\s\S]*?-->/g) : text
    if (markup) {
      for (const m of body.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
        scanCss(blankCssComments(m[2], ".css"), m.index + m[1].length, raw, opts)
      }
      body = blank(body, /<style\b[^>]*>[\s\S]*?<\/style>/gi)
    }
    const styleAttr = /(?<![\w:.-])style\s*=\s*(["'])([^"'\n]*)\1/g
    for (const m of body.matchAll(styleAttr)) {
      scanCss(m[2], m.index + m[0].length - m[2].length - 1, raw, opts)
    }
    body = blank(body, styleAttr)
    scanClasses(body, 0, raw, opts, { bootstrap: true })
    scanJsStyles(body, raw)
    if (!markup) scanCss(body, 0, raw, opts, { inJs: true })
    scanMarkup(body, raw)
    scanIntl(body, raw)
  } else {
    return []
  }

  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
  const ignored = ignoredLines(text)
  const seen = new Set()
  const findings = []
  for (const f of raw.sort((a, b) => a.index - b.index)) {
    const key = `${f.index}:${f.rule}`
    if (seen.has(key)) continue
    seen.add(key)
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= f.index) lo = mid
      else hi = mid - 1
    }
    const line = lo + 1
    if (ignored.has(line)) continue
    findings.push({ line, column: f.index - starts[lo] + 1, ...f })
  }
  return findings
}

/** Applies every "error" finding that has a drop-in replacement. Returns the new text and count. */
export function applyFixes(text, findings) {
  let out = text
  let count = 0
  let limit = Infinity
  const fixable = findings.filter((f) => f.severity === "error" && f.replace != null).sort((a, b) => b.index - a.index)
  for (const f of fixable) {
    const end = f.index + f.found.length
    if (end > limit || out.slice(f.index, end) !== f.found) continue
    out = out.slice(0, f.index) + f.replace + out.slice(end)
    limit = f.index
    count++
  }
  return { text: out, count }
}

/** Reads the major Tailwind version from the nearest package.json (null when not found). */
export function detectTailwind(start) {
  let dir = resolve(start)
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, "package.json")
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, "utf8"))
        const range = { ...json.peerDependencies, ...json.devDependencies, ...json.dependencies }.tailwindcss
        const major = range && /(\d+)/.exec(range)
        if (major) return Number(major[1])
      } catch {}
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function listFiles(targets, ignore = []) {
  const files = []
  const supported = (p) => {
    const ext = extname(p).toLowerCase()
    return (CSS_EXT.has(ext) || MARKUP_EXT.has(ext) || JS_EXT.has(ext)) && !/\.min\.|\.d\.[cm]?ts$/.test(p)
  }
  const skip = (p) => ignore.some((s) => p.replaceAll("\\", "/").includes(s))
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (skip(p)) continue
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(p)
      } else if (entry.isFile() && supported(p) && statSync(p).size <= MAX_BYTES) {
        files.push(p)
      }
    }
  }
  for (const t of targets) {
    const p = resolve(t)
    if (!existsSync(p)) throw new Error(`no such file or folder: ${t}`)
    if (statSync(p).isDirectory()) walk(p)
    else if (!skip(p)) files.push(p)
  }
  return files
}

export function scanPaths(targets, { ignore = [], tailwind, fix = false, min = "info" } = {}) {
  const files = listFiles(targets, ignore)
  const tw = tailwind ?? detectTailwind(statSync(resolve(targets[0])).isDirectory() ? targets[0] : dirname(resolve(targets[0])))
  const findings = []
  let fixed = 0
  for (const file of files) {
    let text = readFileSync(file, "utf8")
    let found = scanText(text, file, { tailwind: tw ?? 4 })
    if (fix && found.some((f) => f.severity === "error" && f.replace != null)) {
      const result = applyFixes(text, found)
      if (result.count) {
        writeFileSync(file, result.text)
        fixed += result.count
        text = result.text
        found = scanText(text, file, { tailwind: tw ?? 4 })
      }
    }
    for (const f of found) if (RANK[f.severity] >= RANK[min]) findings.push({ file, ...f })
  }
  return { files: files.length, tailwind: tw, fixed, findings }
}

// ─── Output ─────────────────────────────────────────────────────────────────────────────────
const RULE_INFO = {
  "tw-physical": "physical Tailwind utilities → logical (ms/me, ps/pe, start/end, text-start, border-s, rounded-s)",
  "bs-physical": "physical Bootstrap classes → Bootstrap 5 logical names",
  "css-physical": "physical CSS properties → logical (margin-inline-start, inset-inline-end, text-align: start)",
  "js-style": "physical inline style keys → logical (marginInlineStart, insetInlineEnd)",
  "css-rtl-override": "[dir=rtl] overrides that become dead weight once the base rule is logical",
  "css-translate": "horizontal transforms/animations that need a mirrored RTL version",
  "tw-translate": "horizontal translate utilities that need an rtl: counterpart",
  "tw-space-x": "space-x margins: prefer gap-x on flex/grid parents",
  "tw-gradient": "directional gradients",
  "tw-origin": "transform origins on menus and popovers",
  "html-dir": "<html> without a per-locale dir",
  "html-lang": "<html> without lang",
  "input-ltr": "email, phone and URL inputs that need dir=\"ltr\"",
  "icon-mirror": "arrows/chevrons that must mirror in RTL (never logos, media controls, checkmarks or clocks)",
  "arrow-glyph": "→ ← characters in text that will point the wrong way",
  "letter-spacing": "letter-spacing that breaks joined Arabic letters",
  "intl-locale": "number/date formatting without the active locale",
}

const ANSI = { dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m", reset: "\x1b[0m" }
const SEV_COLOR = { error: "red", warn: "yellow", info: "cyan" }

export function formatHuman(result, { color = false, cwd = process.cwd() } = {}) {
  const c = (name, s) => (color ? `${ANSI[name]}${s}${ANSI.reset}` : s)
  const { findings, files, fixed } = result
  const lines = []
  if (fixed) lines.push(c("green", `rtl-ready: applied ${fixed} safe fix${fixed === 1 ? "" : "es"}.`))
  if (!findings.length) {
    lines.push(c("green", `rtl-ready: ${files} file${files === 1 ? "" : "s"} scanned, no RTL issues found ✓`))
    return lines.join("\n")
  }
  const count = { error: 0, warn: 0, info: 0 }
  for (const f of findings) count[f.severity]++
  const withFindings = new Set(findings.map((f) => f.file)).size
  lines.push(
    c("bold", `rtl-ready: ${findings.length} finding${findings.length === 1 ? "" : "s"} in ${withFindings} of ${files} files`) +
      ` · ${c("red", `${count.error} fix`)} · ${c("yellow", `${count.warn} check`)} · ${c("cyan", `${count.info} tip`)}`,
    "",
  )
  const loc = (f) => `${relative(cwd, f.file).replaceAll("\\", "/") || f.file}:${f.line}:${f.column}`
  const width = Math.min(60, Math.max(...findings.map((f) => loc(f).length)))
  for (const f of findings) {
    const what = f.replace != null ? `${f.found} → ${f.replace}` : f.found
    const hint = f.severity !== "error" && f.hint ? c("dim", `  ${f.hint}`) : ""
    lines.push(`${loc(f).padEnd(width)}  ${c(SEV_COLOR[f.severity], LABEL[f.severity].padEnd(5))}  ${what}${hint}  ${c("dim", f.rule)}`)
  }
  const byRule = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  lines.push("", c("bold", "By rule"))
  const ruleWidth = Math.max(...Object.keys(byRule).map((r) => r.length))
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${rule.padEnd(ruleWidth)}  ${String(n).padStart(4)}  ${c("dim", RULE_INFO[rule] ?? "")}`)
  }
  lines.push(
    "",
    c("dim", "fix = safe drop-in replacement (apply all with --fix) · check = needs a look · tip = advice"),
    c("dim", 'Silence a line with a comment containing "rtl-ready-ignore" (or "rtl-ready-ignore-next-line"),'),
    c("dim", 'and a block, such as an HTML email template, between "rtl-ready-ignore-start" and "rtl-ready-ignore-end".'),
  )
  return lines.join("\n")
}

export function formatJson(result, { cwd = process.cwd() } = {}) {
  const summary = { error: 0, warn: 0, info: 0 }
  for (const f of result.findings) summary[f.severity]++
  return JSON.stringify(
    {
      tool: "rtl-ready",
      version: VERSION,
      tailwind: result.tailwind,
      files: result.files,
      fixed: result.fixed,
      summary,
      findings: result.findings.map(({ index, file, ...f }) => ({ file: relative(cwd, file).replaceAll("\\", "/"), ...f })),
    },
    null,
    2,
  )
}

const HELP = `rtl-ready scan ${VERSION}: find code that breaks in right-to-left layouts.

Usage: node scan.mjs [paths…] [options]

  --json            machine-readable output
  --fix             apply the safe drop-in replacements ("fix" findings) in place
  --min <level>     lowest level to show: fix | check | tip (default: tip)
  --ignore <text>   skip paths containing <text> (repeatable)
  --tailwind <3|4>  Tailwind major version (default: read from package.json, else 4)
  --exit-zero       exit 0 even when there are findings
  -h, --help        show this help

Silence findings with a comment that says why:
  rtl-ready-ignore             this line
  rtl-ready-ignore-next-line   the next line
  rtl-ready-ignore-start       every line up to rtl-ready-ignore-end (an HTML email template)
  rtl-ready-ignore-file        the whole file

Exit codes: 0 clean (or only tips), 1 fix/check findings, 2 usage error.`

export function parseArgs(argv) {
  const opts = { targets: [], ignore: [], json: false, fix: false, exitZero: false, min: "info", tailwind: undefined }
  const levels = { fix: "error", check: "warn", tip: "info", error: "error", warn: "warn", info: "info" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? a.split(/=(.*)/s) : [a, undefined]
    const value = () => {
      const v = inline ?? argv[++i]
      if (v == null) throw new Error(`${flag} needs a value`)
      return v
    }
    if (flag === "--json") opts.json = true
    else if (flag === "--fix") opts.fix = true
    else if (flag === "--exit-zero") opts.exitZero = true
    else if (flag === "--ignore") opts.ignore.push(value())
    else if (flag === "--min") {
      const v = value()
      if (!levels[v]) throw new Error(`--min must be fix, check or tip (got ${v})`)
      opts.min = levels[v]
    } else if (flag === "--tailwind") {
      const v = Number(value())
      if (v !== 3 && v !== 4) throw new Error("--tailwind must be 3 or 4")
      opts.tailwind = v
    } else if (flag === "-h" || flag === "--help") opts.help = true
    else if (flag === "--version" || flag === "-v") opts.version = true
    else if (flag.startsWith("-")) throw new Error(`unknown option ${flag}`)
    else opts.targets.push(a)
  }
  if (!opts.targets.length) opts.targets.push(".")
  return opts
}

export function main(argv = process.argv.slice(2)) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    console.error(`rtl-ready: ${e.message}\n\n${HELP}`)
    return 2
  }
  if (opts.help) return console.log(HELP), 0
  if (opts.version) return console.log(VERSION), 0
  let result
  try {
    result = scanPaths(opts.targets, opts)
  } catch (e) {
    console.error(`rtl-ready: ${e.message}`)
    return 2
  }
  const color = !opts.json && process.stdout.isTTY && !process.env.NO_COLOR
  console.log(opts.json ? formatJson(result) : formatHuman(result, { color }))
  if (opts.exitZero) return 0
  return result.findings.some((f) => f.severity !== "info") ? 1 : 0
}

const self = fileURLToPath(import.meta.url)
const invoked = process.argv[1] ? resolve(process.argv[1]) : ""
if (invoked === self || pathToFileURL(invoked).href === import.meta.url || invoked.toLowerCase() === self.toLowerCase()) {
  process.exitCode = main()
}
