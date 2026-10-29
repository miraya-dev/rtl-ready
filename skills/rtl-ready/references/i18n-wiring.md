# Wiring `dir` and `lang` per locale

Everything else depends on `<html lang="ar" dir="rtl">`:
- logical CSS and Tailwind `rtl:` variants
- `:lang(ar)` typography, screen-reader pronunciation and font choice
- the browser's own form controls

Set both on `<html>`, server-rendered, for every locale, and update them on a client-side locale
switch.

## Which locales are RTL

```ts
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "ckb", "dv"])
export const dirOf = (locale: string) => (RTL.has(locale.split("-")[0].toLowerCase()) ? "rtl" : "ltr")
```

`new Intl.Locale(locale).textInfo?.direction` (or the older `getTextInfo()` method) also works in
Node and Chromium, but not in every browser. The set above is portable.

## Next.js App Router + next-intl

```tsx
// app/[locale]/layout.tsx
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import { routing } from "@/i18n/routing"
import { dirOf } from "@/i18n/dir"

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
```

- Keep `<html>` in `app/[locale]/layout.tsx`. A root `app/layout.tsx` that returns `children` only
  is fine.
- A client-side locale switcher that navigates to `/{locale}/…` re-renders the layout, so `dir`
  follows.
- Pages router: in `pages/_document.tsx`, use `<Html lang={locale} dir={dirOf(locale)}>` with
  `this.props.locale`.

## i18next / react-i18next

```ts
import i18n from "i18next"

const apply = (lng: string) => {
  document.documentElement.lang = lng
  document.documentElement.dir = i18n.dir(lng)        // "rtl" | "ltr", built in
}
i18n.on("languageChanged", apply)
apply(i18n.resolvedLanguage ?? i18n.language)
```

With SSR, also render `dir`/`lang` on the server (for example `next-i18next` in `_document`, or
your framework's HTML template). Otherwise the first paint is LTR and then jumps.

## Other stacks (one line each)

- **Vue I18n:** `watch(locale, (l) => { document.documentElement.lang = l; document.documentElement.dir = dirOf(l) }, { immediate: true })`.
  Nuxt i18n: set `dir` per locale in `locales`, and `useLocaleHead()` adds it.
- **Angular:** set `dir` on `<html>`. CDK components read `Directionality` from the `dir`
  attribute.
- **SvelteKit:** in `src/app.html` use `<html lang="%lang%" dir="%dir%">`, and fill them in
  `transformPageChunk` in `hooks.server.ts`.
- **Astro:** `<html lang={Astro.currentLocale} dir={dirOf(Astro.currentLocale)}>`.
- **Plain HTML:** `<html lang="ar" dir="rtl">` on the Arabic pages.

## Component libraries need to know too

| Library | How |
|---|---|
| Radix UI / shadcn/ui | wrap the app in `<DirectionProvider dir={dir}>` (from `@radix-ui/react-direction`, or `radix-ui`) |
| MUI | `createTheme({ direction: "rtl" })`, plus an emotion cache with `stylis-plugin-rtl` |
| Ant Design | `<ConfigProvider direction="rtl">` |
| Mantine | `<DirectionProvider>` plus `dir` on `<html>` |
| Headless UI, React Aria | read `dir` from the DOM / locale (`<I18nProvider locale>` for React Aria) |
| Carousels | Embla `direction: "rtl"`, Swiper `dir="rtl"`, Keen Slider `rtl: true` |
| Charts | most draw on canvas/SVG and ignore `dir`; decide the axis direction on purpose |

## Test both directions

- Add an RTL locale to your visual or e2e tests, for example a Playwright project that opens
  `/ar` or sets `document.documentElement.dir = "rtl"`. Screenshot the key pages in both.
- Pseudo-localising helps find concatenated strings: use longer strings, with Arabic letters if
  you can.
- Check at mobile width. Overflow and clipped icons show up there first.
