# Contributing

Thanks for helping make the web work in Arabic, Hebrew, Persian and Urdu.

## Ground rules

- **No dependencies.** `scan.mjs` must keep running with a bare `node` (18.17+), on any OS.
- **No false fixes.** A `fix` finding is applied by `--fix` without review. Only make a rule a
  `fix` when the replacement is always correct. Anything that needs judgment is a `check`.
- **Keep SKILL.md lean.** Details go in `skills/rtl-ready/references/*.md`, one topic per file.

## Workflow

```bash
npm test                          # node --test, no install needed
node skills/rtl-ready/scripts/scan.mjs examples/before
claude --plugin-dir .             # try the skill locally, then /rtl-ready:rtl-ready
claude plugin validate . --strict # check the plugin and marketplace manifests
```

## Adding or changing a rule

1. Add a failing test in `test/scan.test.mjs`. Include at least one case the rule must **not** flag.
2. Implement the rule in `skills/rtl-ready/scripts/scan.mjs` and give it a short id.
3. Add the id to `RULE_INFO`, and to the table in `SKILL.md` if it is a new kind of check.
4. Run the scanner on a real project and confirm that no new false positives appear.

## Reporting a false positive or a missed case

Open an issue with the smallest snippet that shows it, the file type, and what you expected. RTL
speakers' input on the guidance (what to mirror, typography, digits) is especially welcome.
