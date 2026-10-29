# Bidirectional text, numbers, dates and forms

The browser's bidi algorithm lays out Arabic and English in one paragraph correctly most of the
time. It goes wrong at the **edges of an LTR run inside RTL text**. Those edges are where weak
characters sit: punctuation, `+`, `-`, `/`, `@`, `.`, spaces and parentheses.

| You write (RTL paragraph) | Without isolation it shows | Fix |
|---|---|---|
| `اتصل بنا: +212 6 12 34 56 78` | the `+` jumps to the far end | `<bdi dir="ltr">+212 6 12 34 56 78</bdi>` |
| `الإصدار v2.1.0-beta` | `beta-v2.1.0` order breaks | `<bdi dir="ltr">v2.1.0-beta</bdi>` |
| `شغّل npm i -D rtl-ready` | flags reorder | `<code dir="ltr">npm i -D rtl-ready</code>` |
| `مرحبا Sara!` | `!` lands on the wrong side | `<bdi>Sara</bdi>!` |
| `السعر (USD 49)` | brackets attach to the wrong run | `(<bdi dir="ltr">USD 49</bdi>)` |

## LTR islands

Always LTR, whatever the page direction:

- phone numbers, emails, URLs, domains and IP addresses
- code, commands, file paths, keyboard shortcuts and version numbers
- IBANs, card numbers, order/tracking IDs, SKUs, license plates, math and formulas

For a block (`<code>`, `<pre>`, a field, a table cell), set `dir="ltr"` on the element. For text
inline in a sentence, use `<bdi dir="ltr">…</bdi>` or `<span dir="ltr">…</span>`; an element with a
`dir` attribute is isolated by default. Keep the alignment logical, for example `text-end` or
`rtl:text-right`, so the block still lines up with the rest of the RTL column.

An element with its own `dir="ltr"` also flips **its own** logical margins and paddings. In an RTL
page, `ms-2` on `<span dir="ltr">` puts the gap on the left, away from the Arabic label. Put the
spacing on the parent instead (`gap-*`, or a plain space before the `<bdi>`), not on the LTR
island.

```tsx
<a href={`mailto:${email}`} dir="ltr">{email}</a>
<span dir="ltr" className="font-mono">{orderId}</span>
<p>{t("callUs")} <bdi dir="ltr">{phone}</bdi></p>
```

## Text of unknown direction

Names, titles, comments, search results and anything else users type can be in either direction.

- Inline: wrap it in `<bdi>`. Its default is `dir="auto"`, so it isolates the text from its
  neighbours and picks the direction from the first strong letter.
- Blocks: use `dir="auto"` on `<p>`, `<li>`, `<td>` or `<textarea>`, or CSS `unicode-bidi: plaintext`.
- In places where you can't use markup (`title`, `placeholder`, `<option>`, `document.title`, toast
  and notification APIs), wrap the value in Unicode isolates:
  - FSI `⁨` … PDI `⁩` (first strong)
  - LRI `⁦` / RLI `⁧` … PDI `⁩` (forced)

```ts
const isolate = (s: string) => `⁨${s}⁩`
document.title = `${isolate(projectName)} · ${t("dashboard")}`
```

## Strings and translations

- **Never build sentences by concatenation** (`t("hello") + name + "!"`), because word order
  changes between languages. Use placeholders: `"مرحبا {name}!"`.
- **Plurals:** Arabic has six plural forms (zero, one, two, few, many, other). Use ICU MessageFormat
  (next-intl, FormatJS, i18next with `Intl.PluralRules`) instead of `count === 1 ? … : …`.
- **Gender:** Arabic and Hebrew verbs agree with gender. Use `select` in ICU messages when you
  address the user.
- **Spaces and punctuation:** Arabic uses `،` (comma), `؛` (semicolon) and `؟` (question mark).
  Translators should write them; don't append Latin punctuation in code.

## Numbers, currencies, dates

Format everything with `Intl` and the active locale. Never format by hand.

```ts
const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "MAD" })
nf.format(1299.5)          // ar-MA → "1.299,50 د.م.‏"   en → "MAD 1,299.50"
new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date)
new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day")   // "أمس"
new Intl.ListFormat(locale, { type: "conjunction" }).format(["أ", "ب", "ج"])
```

- **Digits:** the defaults depend on the region and on the engine's ICU version.
  - In current ICU, `ar-EG` and `ar-SA` give Arabic-Indic digits ٠١٢٣.
  - Plain `ar`, the Maghreb locales (`ar-MA`, `ar-DZ`, `ar-TN`), `he` and `ur` give 0–9.
    Older engines gave ٠١٢٣ for plain `ar`.
  - `fa` gives Persian digits ۰۱۲۳.

  Choose on purpose and force the choice with a Unicode extension: `"ar-u-nu-latn"` gives 0–9 and
  `"ar-u-nu-arab"` gives ٠١٢٣. Keep it consistent across the app, including charts and tables.
- **Percent, currency and minus sign** positions differ by locale. Let `Intl` place them, and
  don't write `${n}%`.
- **Calendars:** older engines used the Islamic calendar by default for `ar-SA`; current ICU uses
  Gregorian. Don't rely on the default: pass `calendar: "gregory"`, or `-u-ca-islamic-umalqura`
  if you need Hijri dates.
- **Parsing user input:** accept both digit sets. Normalise ٠-٩ and ۰-۹ to 0-9 before validating
  phone numbers, codes and amounts.
- **Tabular numbers:** use `font-variant-numeric: tabular-nums` in tables and prices so columns
  don't jitter.

## Forms

- Text fields inherit the page direction, which is right for Arabic/Hebrew text.
- **Email, phone, URL, password, OTP/code, card number, IBAN:** use `dir="ltr"`, so the cursor,
  selection and punctuation behave. To keep the field lined up with the others, align it to the
  end in RTL: `<input type="email" dir="ltr" class="rtl:text-right">`.
- **Free text** (name, message, search) where users may type either language: use `dir="auto"`,
  so English typed into an Arabic form starts at the left.
- **Icons inside fields:** use `absolute start-3` for the icon and `ps-10` for the input, so both
  flip together.
  - **Watch out with `dir="ltr"` fields.** The input's own logical padding follows the input's own
    direction, so `ps-10` stays on the left while the icon (`start-3`) moves right. For an LTR
    field with an icon, put the border and the icon on a flex wrapper and keep the input's padding
    symmetric:

    ```html
    <span class="flex items-center rounded-lg border">
      <svg class="ms-3 size-4">…</svg>
      <input type="email" dir="ltr" class="w-full bg-transparent px-3 py-2.5 outline-none rtl:text-right">
    </span>
    ```
- **Custom select arrows and clear buttons:** use `end-3` and `pe-8`.
- **Checkbox/radio with label:** use `flex items-center gap-2` (not `mr-2`).
- **Labels, help text and error messages:** use `text-start`. Keep error icons at the start.
- **Native controls** (`<select>`, `<input type="range">`, date pickers) follow `dir` by themselves.
  Custom date pickers must start the week on the right day for the locale
  (`new Intl.Locale(locale).weekInfo` where supported) and mirror their prev/next arrows.
- **Masks and formatters** (phone, card) work on the LTR value. Don't mirror the mask.
