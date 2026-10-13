# Cambridge Pseudocode (9618) — VS Code Extension

[![ci](https://github.com/fahrulseptiana/cambridge-pseudocode-lsp/actions/workflows/build-release.yml/badge.svg)](https://github.com/fahrulseptiana/cambridge-pseudocode-lsp/actions)
[![release](https://img.shields.io/github/v/release/fahrulseptiana/cambridge-pseudocode-lsp)](https://github.com/fahrulseptiana/cambridge-pseudocode-lsp/releases)
[![license](https://img.shields.io/github/license/fahrulseptiana/cambridge-pseudocode-lsp)](./LICENSE)
[![last commit](https://img.shields.io/github/last-commit/fahrulseptiana/cambridge-pseudocode-lsp)](https://github.com/fahrulseptiana/cambridge-pseudocode-lsp/commits/main)
[![language](https://img.shields.io/badge/language-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/fahrulseptiana/cambridge-pseudocode-lsp/pulls)

Language support for **Cambridge International AS & A Level Computer Science 9618 pseudocode**
(exams 2026), following the *Pseudocode Guide for Teachers* (Cambridge University Press & Assessment).

Works on **`.pseudo`** and **`.psc`** files and installs as **`fahrul.pseudo-lsp`**.

## Features

- **Diagnostics** — syntax errors, unknown identifiers, duplicate declarations,
  type mismatches, constant assignment, `NEXT` mismatches, `CALL` misuse,
  built-in argument checks
- **Completion** — construct snippets (`IF…ENDIF`, `FOR…NEXT`, `CASE OF…ENDCASE`, …),
  keywords, data types, built-in functions, declared symbols, OOP members after `object.`
- **Hover & go-to-definition** — symbol details, signatures, built-in docs, jump to declarations
- **Outline, folding & formatting** — document hierarchy, block folding, 3-space re-indentation
- **Coloring** — semantic highlighting by role plus a TextMate grammar fallback

## Quick start

```bash
npm install                    # client + server (npm workspaces)
npm run build                  # compile both
npm test                       # unit tests
node scripts/lsp-smoke.mjs     # end-to-end LSP check over stdio
```

Press **F5** (uses `client/.vscode/launch.json`) to start an Extension
Development Host. Open any `.pseudo`/`.psc` file — the language server starts
automatically. `sample/welcome.pseudo` (clean) and `sample/errors.pseudo`
(intentional mistakes) demonstrate every feature.

## Building a release

```bash
npm run package:vsix           # → build/pseudo-lsp-<version>.vsix (self-contained)
code --install-extension build/pseudo-lsp-<version>.vsix
```

On GitHub, pushing a **`v*` tag** (e.g. `v0.1.1`) runs CI and attaches the
packaged `.vsix` to a GitHub Release:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

## Layout & design

```
client/   VS Code extension (LSP client, grammar, launch config)
server/   language server
  src/core/   the language: lexicon → scanner → parser → analyzer → formatter
  src/lsp/    thin protocol adapters — one provider module per feature
  test/       unit tests
scripts/  e2e smoke test, .vsix packaging
.github/  CI workflow
```

Principles: **SOLID, YAGNI, DRY** — `core/` never imports LSP types, the whole
vocabulary lives in `core/lexicon.ts` only, and every analyzer check/feature
stays small and single-purpose.

## Intentional relaxations

- Assignment operator is `←` (guide) with `<-` and `:=` accepted as typing aids
- Identifiers are **case-insensitive** (guide §2.3)
- Assigning/`INPUT` to an undeclared name creates the variable implicitly, with
  a hint to add `DECLARE` (the guide treats `DECLARE` as good practice, §2.4)
- `CHAR` values may be joined with the `&` operator

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE). The
pseudocode rules follow the Cambridge 9618 guide, which is © Cambridge
University Press & Assessment.