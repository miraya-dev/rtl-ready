import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { applyFixes, detectTailwind, parseArgs, scanText } from "../skills/rtl-ready/scripts/scan.mjs"

const SCAN = fileURLToPath(new URL("../skills/rtl-ready/scripts/scan.mjs", import.meta.url))

/** `found → replace` pairs for one rule, in source order. */
const pairs = (findings, rule) => findings.filter((f) => !rule || f.rule === rule).map((f) => [f.found, f.replace])
const rules = (findings) => findings.map((f) => f.rule)

describe("Tailwind classes", () => {
  it("maps physical utilities to logical ones", () => {
    const html = `<div class="ml-4 mr-auto pl-2 pr-[10px] left-0 right-1/2 text-left text-right float-left clear-right border-l border-r-2 border-l-red-500/50 rounded-l rounded-r-lg rounded-tl-md rounded-br-none scroll-ml-4 scroll-pr-2"></div>`
    assert.deepEqual(pairs(scanText(html, "a.html"), "tw-physical"), [
      ["ml-4", "ms-4"],
      ["mr-auto", "me-auto"],
      ["pl-2", "ps-2"],
      ["pr-[10px]", "pe-[10px]"],
      ["left-0", "start-0"],
      ["right-1/2", "end-1/2"],
      ["text-left", "text-start"],
      ["text-right", "text-end"],
      ["float-left", "float-start"],
      ["clear-right", "clear-end"],
      ["border-l", "border-s"],
      ["border-r-2", "border-e-2"],
      ["border-l-red-500/50", "border-s-red-500/50"],
      ["rounded-l", "rounded-s"],
      ["rounded-r-lg", "rounded-e-lg"],
      ["rounded-tl-md", "rounded-ss-md"],
      ["rounded-br-none", "rounded-ee-none"],
      ["scroll-ml-4", "scroll-ms-4"],
      ["scroll-pr-2", "scroll-pe-2"],
    ])
  })

  it("keeps variants, negatives and important flags", () => {
    const jsx = `<div className="md:-ml-4 hover:!pl-2 group-hover:pr-1! data-[open=true]:left-0 [&_svg]:mr-2" />`
    assert.deepEqual(pairs(scanText(jsx, "a.tsx")), [
      ["md:-ml-4", "md:-ms-4"],
      ["hover:!pl-2", "hover:!ps-2"],
      ["group-hover:pr-1!", "group-hover:pe-1!"],
      ["data-[open=true]:left-0", "data-[open=true]:start-0"],
      ["[&_svg]:mr-2", "[&_svg]:me-2"],
    ])
  })

  it("finds classes inside cn(), template strings and arrays", () => {
    const ts = "const a = cn('ml-2', cond && \"pr-4\", `text-left ${x}`, ['left-0'])"
    assert.deepEqual(
      pairs(scanText(ts, "a.ts")).map((p) => p[0]),
      ["ml-2", "pr-4", "text-left", "left-0"],
    )
  })

  it("ignores logical, symmetric, direction-scoped and look-alike tokens", () => {
    const html = `<div class="ms-4 pe-2 mx-auto px-3 start-0 inset-x-0 text-center rtl:mr-2 ltr:ml-2 [dir=rtl]:pl-4 left-panel ml-gutter rounded-lg border-lg border-left-panel">`
    assert.deepEqual(scanText(html, "a.html").filter((f) => f.rule.startsWith("tw-")), [])
  })

  it("leaves utilities tied to a physical side variant alone (Radix data-[side=left])", () => {
    const tsx = `<div className="data-[side=left]:left-0 data-[side=right]:-right-1 data-[side=left]:translate-x-[-2.5rem] group-data-[placement=right-start]:ml-2" />`
    assert.deepEqual(scanText(tsx, "a.tsx"), [])
  })

  it("flips arbitrary negative translate values without a double minus", () => {
    assert.deepEqual(pairs(scanText(`<a class="translate-x-[-2.5rem] -translate-x-[-1px]">`, "a.html")), [
      ["translate-x-[-2.5rem]", "translate-x-[-2.5rem] rtl:translate-x-[2.5rem]"],
      ["-translate-x-[-1px]", "-translate-x-[-1px] rtl:-translate-x-[1px]"],
    ])
  })

  it("leaves the left-1/2 + -translate-x-1/2 centring pattern alone", () => {
    assert.deepEqual(scanText(`<div class="absolute left-1/2 -translate-x-1/2"></div>`, "a.html"), [])
  })

  it("asks to mirror translate, gradients and origins", () => {
    const html = `<aside class="-translate-x-full md:translate-x-4 bg-linear-to-r bg-gradient-to-tl origin-top-right"></aside>`
    assert.deepEqual(pairs(scanText(html, "a.html")), [
      ["-translate-x-full", "-translate-x-full rtl:translate-x-full"],
      ["md:translate-x-4", "md:translate-x-4 md:rtl:-translate-x-4"],
      ["bg-linear-to-r", "bg-linear-to-r rtl:bg-linear-to-l"],
      ["bg-gradient-to-tl", "bg-gradient-to-tl rtl:bg-gradient-to-tr"],
      ["origin-top-right", "origin-top-right rtl:origin-top-left"],
    ])
    assert.equal(scanText(`<a class="-translate-x-full rtl:translate-x-full">`, "a.html").length, 0)
  })

  it("accepts an rtl: counterpart that carries more variants", () => {
    const tsx = `<ArrowRightIcon className="rtl:-scale-x-100 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
<aside className="-translate-x-full rtl:[&.open]:translate-x-full bg-linear-to-r rtl:md:bg-linear-to-l origin-top-right rtl:data-[state=open]:origin-top-left" />`
    assert.deepEqual(scanText(tsx, "a.tsx"), [])
    assert.deepEqual(
      scanText(`<a className="group-hover:translate-x-1 rtl:group-hover:-scale-x-100" />`, "a.tsx").map((f) => f.found),
      ["group-hover:translate-x-1"],
    )
  })

  it("leaves the optical centring of a play icon alone", () => {
    const tsx = `<PlayIcon className="size-5 translate-x-0.5" />
<Icons.Play className="translate-x-px" /><i className="lucide-play translate-x-[1px]" />
<PlayIcon
  onClick={() => toggle()}
  className={cn("size-4 [&>path]:fill-current", playing && "hidden", "translate-x-0.5")}
/>
<span className="material-symbols-outlined translate-x-px">play_arrow</span>`
    assert.deepEqual(scanText(tsx, "a.tsx"), [])
    const near = `<PlayIcon className="translate-x-0.5" /><ChevronRight className="rtl:-scale-x-100 group-hover:translate-x-1" /><Player className="translate-x-4" />`
    assert.deepEqual(
      scanText(near, "a.tsx").map((f) => f.found),
      ["group-hover:translate-x-1", "translate-x-4"],
    )
  })

  it("flags space-x-reverse always and space-x only on Tailwind v3", () => {
    const html = `<div class="flex space-x-4 rtl:space-x-reverse"></div>`
    assert.deepEqual(rules(scanText(html, "a.html")), ["tw-space-x"])
    assert.deepEqual(rules(scanText(html, "a.html", { tailwind: 3 })), ["tw-space-x", "tw-space-x"])
  })

  it("reads @apply in CSS but not selectors", () => {
    const css = `.ml-2 { color: red }\n.btn { @apply ml-2 text-left rtl:mr-2; }`
    const found = scanText(css, "a.css")
    assert.deepEqual(pairs(found), [
      ["ml-2", "ms-2"],
      ["text-left", "text-start"],
    ])
    assert.equal(found[0].line, 2)
  })

  it("maps Bootstrap 3/4 classes to Bootstrap 5 names", () => {
    assert.deepEqual(pairs(scanText(`<div class="pull-right rounded-left border-right-0 ml-3">`, "a.html")), [
      ["pull-right", "float-end"],
      ["rounded-left", "rounded-start"],
      ["border-right-0", "border-end-0"],
      ["ml-3", "ms-3"],
    ])
  })
})

describe("CSS", () => {
  it("maps physical properties and values to logical ones", () => {
    const css = `.a {
  margin-left: 8px;
  padding-right: 4px;
  border-left: 1px solid;
  border-right-color: red;
  border-top-left-radius: 4px;
  border-bottom-right-radius: 2px;
  left: 0;
  right: auto;
  text-align: left;
  float: right;
  clear: left;
  scroll-margin-left: 1rem;
}`
    assert.deepEqual(pairs(scanText(css, "a.css")), [
      ["margin-left", "margin-inline-start"],
      ["padding-right", "padding-inline-end"],
      ["border-left", "border-inline-start"],
      ["border-right-color", "border-inline-end-color"],
      ["border-top-left-radius", "border-start-start-radius"],
      ["border-bottom-right-radius", "border-end-end-radius"],
      ["left", "inset-inline-start"],
      ["right", "inset-inline-end"],
      ["text-align: left", "text-align: start"],
      ["float: right", "float: inline-end"],
      ["clear: left", "clear: inline-start"],
      ["scroll-margin-left", "scroll-margin-inline-start"],
    ])
  })

  it("converts asymmetric 4-value shorthands and leaves symmetric ones", () => {
    const css = `.a {
  margin: 0 8px 0 0;
  padding: 4px 2px 4px 6px;
  inset: 0 auto 0 calc(1rem + 2px);
  border-radius: 8px 0 0 8px;
  margin: 0 auto;
  padding: 1px 2px 3px 2px;
  border-radius: 4px 4px 0 0;
  border-radius: 50% / 10%;
  margin: 0 1px 0 2px !important;
}`
    assert.deepEqual(pairs(scanText(css, "a.css")), [
      ["margin: 0 8px 0 0", "margin-block: 0; margin-inline: 0 8px"],
      ["padding: 4px 2px 4px 6px", "padding-block: 4px; padding-inline: 6px 2px"],
      ["inset: 0 auto 0 calc(1rem + 2px)", "inset-block: 0; inset-inline: calc(1rem + 2px) auto"],
      [
        "border-radius: 8px 0 0 8px",
        "border-start-start-radius: 8px; border-start-end-radius: 0; border-end-end-radius: 0; border-end-start-radius: 8px",
      ],
    ])
  })

  it("ignores comments, variables, custom properties and values", () => {
    const css = `/* margin-left: 0 */\n$margin-left: 4px;\n// padding-left: 2px\n.a { --pad-left: 1px; transition: left 0.2s; background: url(x.png) left center; grid-template-areas: "left right"; }`
    assert.deepEqual(scanText(css, "a.scss"), [])
  })

  it("treats rules under [dir=rtl] as overrides to delete, not to convert", () => {
    const css = `.a { margin-left: 8px }\n[dir="rtl"] .a { margin-left: 0; margin-right: 8px }`
    assert.deepEqual(rules(scanText(css, "a.css")), ["css-physical", "css-rtl-override", "css-rtl-override"])
  })

  it("leaves left: 50% + translateX(-50%) centring alone", () => {
    assert.deepEqual(scanText(`.tip { position: absolute; left: 50%; transform: translateX(-50%); }`, "a.css"), [])
  })

  it("asks to mirror horizontal transforms unless an RTL rule exists", () => {
    const css = `.drawer { transform: translateX(-100%) }\n@keyframes in { from { transform: translate(24px, 0) } }\n[dir="rtl"] .drawer { transform: translateX(100%) }\n.y { transform: translateY(4px) translate(0, 2px) }\n.t { transform: translateX(calc(var(--dir) * 120%)) }`
    assert.deepEqual(pairs(scanText(css, "a.css")), [
      ["translateX(-100%)", null],
      ["translate(24px)", null],
    ])
  })

  it("tips about letter-spacing, except 0 or Arabic-scoped rules", () => {
    const css = `h1 { letter-spacing: -0.02em }\nh2 { letter-spacing: 0 }\n:lang(ar) h1 { letter-spacing: 0.1em }`
    const found = scanText(css, "a.css")
    assert.deepEqual(rules(found), ["letter-spacing"])
    assert.equal(found[0].severity, "info")
  })

  it("scans <style> blocks and style attributes in HTML", () => {
    const html = `<style>\n.a { padding-left: 4px }\n</style>\n<p style="margin-right: 2px; text-align: right">x</p>`
    const found = scanText(html, "a.html")
    assert.deepEqual(pairs(found), [
      ["padding-left", "padding-inline-start"],
      ["margin-right", "margin-inline-end"],
      ["text-align: right", "text-align: end"],
    ])
    assert.deepEqual(
      found.map((f) => [f.line, f.column]),
      [
        [2, 6],
        [4, 11],
        [4, 30],
      ],
    )
  })
})

describe("JS style objects and CSS-in-JS", () => {
  it("maps React inline styles", () => {
    const tsx = `<p style={{ marginLeft: 8, paddingRight: 2, borderTopLeftRadius: 4, left: 0, textAlign: "right", float: 'left' }} />`
    assert.deepEqual(pairs(scanText(tsx, "a.tsx")), [
      ["marginLeft", "marginInlineStart"],
      ["paddingRight", "paddingInlineEnd"],
      ["borderTopLeftRadius", "borderStartStartRadius"],
      ["left", "insetInlineStart"],
      ['textAlign: "right"', 'textAlign: "end"'],
      ["float: 'left'", "float: 'inline-start'"],
    ])
  })

  it("does not touch left/right keys outside style objects or TS types", () => {
    const ts = `const pos = { left: 0, right: 10 }\ninterface Box { left: number; right: number }\ntree.left = node`
    assert.deepEqual(scanText(ts, "a.ts"), [])
  })

  it("reads CSS inside styled-components templates", () => {
    const ts = "const Box = styled.div`\n  margin-left: 8px;\n  right: 0;\n`"
    assert.deepEqual(pairs(scanText(ts, "a.ts")), [
      ["margin-left", "margin-inline-start"],
      ["right", "inset-inline-end"],
    ])
  })
})

describe("markup", () => {
  it("flags <html> without dir or lang", () => {
    assert.deepEqual(rules(scanText(`<!doctype html>\n<html>`, "a.html")), ["html-lang", "html-dir"])
    assert.deepEqual(rules(scanText(`<html lang={locale}>`, "layout.tsx")), ["html-dir"])
    assert.deepEqual(scanText(`<html lang={locale} dir={dir}>`, "layout.tsx"), [])
    assert.deepEqual(scanText(`<html :lang="locale" :dir="dir">`, "App.vue"), [])
    assert.deepEqual(
      scanText(`<html lang="en" dir="ltr">`, "a.html").map((f) => [f.rule, f.severity]),
      [["html-dir", "info"]],
    )
  })

  it("asks for dir=ltr on email, phone and URL inputs", () => {
    const tsx = `<input type="email"><input type="tel" dir="ltr"><input type="text"><Input type="url" onChange={(e) => set(e)} />`
    assert.equal(scanText(tsx, "a.tsx").filter((f) => f.rule === "input-ltr").length, 2)
  })

  it("asks to mirror directional icons only", () => {
    const tsx = `<ChevronRight /><ArrowLeftIcon className="size-4" /><ArrowBack /><NavigateNext /><ArrowUpRight />
<ChevronLeft className="rtl:-scale-x-100" /><ArrowLeftRight /><Play /><Check /><Clock /><ChevronDown /><Logo />
<i class="fa fa-arrow-right"></i><i class="bi bi-chevron-left rtl:-scale-x-100"></i><span class="material-icons">arrow_forward</span>`
    assert.deepEqual(
      scanText(tsx, "a.tsx")
        .filter((f) => f.rule === "icon-mirror")
        .map((f) => f.found),
      ["<ChevronRight>", "<ArrowLeftIcon>", "<ArrowBack>", "<NavigateNext>", "<ArrowUpRight>", "fa-arrow-right", "arrow_forward"],
    )
  })

  it("flags arrow characters that will point the wrong way, not mirrored ones", () => {
    const found = scanText(`<a>Next →</a><a>Back &larr;</a><a>More »</a>\n// see → docs`, "a.tsx")
    assert.deepEqual(
      found.map((f) => f.found),
      ["→", "&larr;"],
    )
  })

  it("skips HTML comments and tags mentioned in code comments", () => {
    assert.deepEqual(scanText(`<!-- <div class="ml-2"> -->`, "a.html"), [])
    assert.deepEqual(scanText(`/**\n * \`<html>\` lives in app/[locale]/layout.tsx\n */\n{/* <ChevronRight /> */}`, "layout.tsx"), [])
  })

  it("prints multi-line tags on one line", () => {
    const [f] = scanText(`<Input\n  id="email"\n  type="email"\n/>`, "a.tsx")
    assert.equal(f.found, `<Input id="email" type="email" />`)
  })
})

describe("locale formatting", () => {
  it("tips about Intl without the active locale", () => {
    const found = scanText(
      `a.toLocaleString(); d.toLocaleDateString("en-US"); new Intl.NumberFormat('en').format(1); x.toLocaleString(locale)`,
      "a.ts",
    )
    assert.deepEqual(
      found.map((f) => [f.rule, f.severity]),
      [
        ["intl-locale", "info"],
        ["intl-locale", "info"],
        ["intl-locale", "info"],
      ],
    )
  })
})

describe("ignores and positions", () => {
  it("honours rtl-ready-ignore comments", () => {
    const tsx = `<a className="ml-2" /> {/* rtl-ready-ignore */}\n// rtl-ready-ignore-next-line\n<a className="pl-2" />\n<a className="pr-2" />`
    assert.deepEqual(pairs(scanText(tsx, "a.tsx")), [["pr-2", "pe-2"]])
    assert.deepEqual(scanText(`// rtl-ready-ignore-file\n<a className="pl-2" />`, "a.tsx"), [])
  })

  it("honours rtl-ready-ignore-start/end blocks", () => {
    const ts = [
      `const a = cn("ml-2")`,
      `// rtl-ready-ignore-start: HTML email, many clients ignore logical CSS`,
      "const email = { html: `",
      `  <td style="border-left: 4px solid #ccc; text-align: left">`,
      `  <p class="pl-2">`,
      "` }",
      `// rtl-ready-ignore-end`,
      `const b = cn("pr-2")`,
    ].join("\n")
    assert.deepEqual(pairs(scanText(ts, "a.ts")), [
      ["ml-2", "ms-2"],
      ["pr-2", "pe-2"],
    ])
    assert.equal(scanText(ts.replace(/rtl-ready-ignore-(?:start|end)/g, ""), "a.ts").length, 5)
    assert.deepEqual(scanText(`// rtl-ready-ignore-start\nconst a = cn("ml-2")\nconst b = cn("pr-2")`, "a.ts"), [])
  })

  it("reports 1-based line and column", () => {
    const [f] = scanText(`<div>\n  <p class="x ml-2">`, "a.html")
    assert.equal(f.line, 2)
    assert.equal(f.column, 15)
  })

  it("ignores unknown file types", () => {
    assert.deepEqual(scanText(`margin-left: 0`, "README.md"), [])
  })
})

describe("applyFixes", () => {
  it("applies only safe replacements and keeps everything else", () => {
    const html = `<div class="ml-4 -translate-x-full" style="padding-right: 2px"><ChevronRight /></div>`
    const { text, count } = applyFixes(html, scanText(html, "a.html"))
    assert.equal(count, 2)
    assert.equal(text, `<div class="ms-4 -translate-x-full" style="padding-inline-end: 2px"><ChevronRight /></div>`)
    assert.deepEqual(rules(scanText(text, "a.html")), ["tw-translate", "icon-mirror"])
  })

  it("is idempotent", () => {
    const css = `.a { margin-left: 0; text-align: right }`
    const once = applyFixes(css, scanText(css, "a.css")).text
    assert.equal(applyFixes(once, scanText(once, "a.css")).count, 0)
  })
})

describe("CLI", () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "rtl-ready-"))
    mkdirSync(join(dir, "src"))
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { tailwindcss: "^3.4.0" } }))
    writeFileSync(join(dir, "src", "App.tsx"), `export const A = () => <div className="ml-2 space-x-2"><ChevronRight /></div>\n`)
    writeFileSync(join(dir, "src", "app.css"), `.a { padding-left: 4px }\n`)
    writeFileSync(join(dir, "node_modules", "pkg", "x.css"), `.a { margin-left: 0 }\n`)
    return dir
  }
  const cleanup = (dir) => rmSync(dir, { recursive: true, force: true })

  it("prints JSON, skips node_modules, reads the Tailwind version and exits 1", () => {
    const dir = project()
    try {
      const run = spawnSync(process.execPath, [SCAN, dir, "--json"], { encoding: "utf8", cwd: dir })
      assert.equal(run.status, 1)
      const json = JSON.parse(run.stdout)
      assert.equal(json.files, 2)
      assert.equal(json.tailwind, 3)
      assert.deepEqual(json.summary, { error: 2, warn: 2, info: 0 })
      assert.deepEqual(json.findings.map((f) => `${f.file}:${f.line}:${f.rule}`).sort(), [
        "src/App.tsx:1:icon-mirror",
        "src/App.tsx:1:tw-physical",
        "src/App.tsx:1:tw-space-x",
        "src/app.css:1:css-physical",
      ])
    } finally {
      cleanup(dir)
    }
  })

  it("--fix rewrites files and leaves only the checks", () => {
    const dir = project()
    try {
      const out = execFileSync(process.execPath, [SCAN, dir, "--fix", "--exit-zero"], { encoding: "utf8", cwd: dir })
      assert.match(out, /applied 2 safe fixes/)
      assert.match(out, /"rtl-ready-ignore-start" and "rtl-ready-ignore-end"/)
      assert.match(readFileSync(join(dir, "src", "App.tsx"), "utf8"), /className="ms-2 space-x-2"/)
      assert.equal(readFileSync(join(dir, "src", "app.css"), "utf8"), `.a { padding-inline-start: 4px }\n`)
      assert.equal(readFileSync(join(dir, "node_modules", "pkg", "x.css"), "utf8"), `.a { margin-left: 0 }\n`)
    } finally {
      cleanup(dir)
    }
  })

  it("exits 0 on a clean project", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtl-ready-"))
    try {
      writeFileSync(join(dir, "a.html"), `<html lang="ar" dir="rtl"><p class="ms-2 text-start">مرحبا</p></html>`)
      const run = spawnSync(process.execPath, [SCAN, dir], { encoding: "utf8" })
      assert.equal(run.status, 0)
      assert.match(run.stdout, /no RTL issues found/)
    } finally {
      cleanup(dir)
    }
  })

  it("--min fix hides checks and tips", () => {
    const dir = project()
    try {
      const json = JSON.parse(spawnSync(process.execPath, [SCAN, dir, "--json", "--min", "fix"], { encoding: "utf8" }).stdout)
      assert.deepEqual(json.summary, { error: 2, warn: 0, info: 0 })
    } finally {
      cleanup(dir)
    }
  })

  it("rejects bad options with exit 2", () => {
    assert.equal(spawnSync(process.execPath, [SCAN, "--min", "loud"], { encoding: "utf8" }).status, 2)
    assert.equal(spawnSync(process.execPath, [SCAN, "does-not-exist"], { encoding: "utf8" }).status, 2)
    assert.throws(() => parseArgs(["--tailwind", "5"]))
    assert.deepEqual(parseArgs(["src", "--min=fix", "--ignore", "gen/"]).ignore, ["gen/"])
  })

  it("--help lists the ignore comments", () => {
    const out = execFileSync(process.execPath, [SCAN, "--help"], { encoding: "utf8" })
    for (const comment of ["ignore-next-line", "ignore-start", "ignore-end", "ignore-file"]) {
      assert.match(out, new RegExp(`rtl-ready-${comment}`))
    }
  })

  it("detectTailwind returns null without a tailwindcss dependency", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtl-ready-"))
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0" } }))
      assert.equal(detectTailwind(dir), null)
    } finally {
      cleanup(dir)
    }
  })
})
