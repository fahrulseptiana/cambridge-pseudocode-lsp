# Contributing to Cambridge Pseudocode (9618) LSP

Thanks for considering a contribution! This is a small, focused project — a
language server and VS Code extension for Cambridge International
AS & A Level **Computer Science 9618 pseudocode** — and every contribution
matters, whether it's a bug report, a test, a parser fix or documentation.

Before you start, please read the [README](README.md) — it documents the
architecture and the language coverage, both of which are tightly coupled to
the design principles below.

## Table of contents

- [Questions, bugs & feature requests](#questions-bugs--feature-requests)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Design principles](#design-principles)
- [Building, testing, packaging](#building-testing-packaging)
- [Running and debugging in VS Code](#running-and-debugging-in-vs-code)
- [Making changes](#making-changes)
- [Commit conventions](#commit-conventions)
- [Branching and pull requests](#branching-and-pull-requests)
- [Release process](#release-process)
- [Code style](#code-style)
- [License](#license)

## Questions, bugs & feature requests

- **Ask questions and report problems** by opening a [GitHub issue](../../issues).
  Include the pseudocode snippet that triggers the problem — minimal examples
  get faster answers.
- When reporting a diagnostic that fires on valid code, mention the guide
  section you believe applies (e.g. "the guide's §7.2") so the fix can be
  checked against the exam specification.
- The guide PDF itself is deliberately **not** in the repository (copyright);
  if you need to double-check behaviour, the language coverage is summarised in
  the README and the exact rules live in the analyzer tests.

## Development setup

- **Node.js ≥ 18** (development happens on Node 20/24; CI runs Node 20)
- **npm** (the repo uses npm workspaces for `client/` and `server/`)
- **VS Code** — needed only if you want to run the extension host

```bash
npm install   # installs client + server workspaces
npm run build # compiles TypeScript in both workspaces
```

## Project layout

```
client/   VS Code extension — LSP client, TextMate grammar, language config
server/   language server
  src/core/    pure language layer: lexicon → scanner → ast → parser → analyzer → formatter
  src/lsp/     protocol adapters: service seam + one provider module per feature
  test/        unit tests (node:test)
scripts/      lsp-smoke.mjs (e2e stdio test), package-vsix.mjs (release build)
.github/      CI workflow
sample/       example .pseudo files used by the smoke test
```

## Design principles

The project deliberately follows **SOLID**, **YAGNI** and **DRY**. Please keep
these invariants intact whenever you change code:

1. **`core/` never imports from `lsp/` or `vscode-*`** — it operates on plain
   AST nodes, ranges and symbols. If you need LSP types, stay in `lsp/`.
2. **Vocabulary lives only in `core/lexicon.ts`** — keywords, data types,
   operators and built-in functions. The scanner, parser checks, completion,
   hover docs and semantic tokens all derive from it (DRY). When you add a
   keyword, that's the *only* file you edit for recognition + completion +
   coloring to pick it up.
3. **One module, one job.** New LSP features go in a new file under
   `server/src/lsp/providers/` and are wired once in `server.ts`.
4. **YAGNI** — don't add features the guide doesn't ask for, and keep the
   analyzer's weak, literal-driven type inference: avoid introducing new
   false-positive errors on valid student code.

## Building, testing, packaging

```bash
npm run build                # tsc for server + client
npm test                     # unit tests (server/test/*.test.ts, node:test)
node scripts/lsp-smoke.mjs   # end-to-end JSON-RPC session over stdio
npm run package:vsix         # assemble a standalone .vsix into build/
```

All of these run in CI on every push/PR. Please make sure they pass locally
before opening a PR — for parser/analyzer changes, add or update at least one
test in `server/test/`.

## Running and debugging in VS Code

1. Open the repository in VS Code.
2. Press **F5** (uses `client/.vscode/launch.json`) — an Extension Development
   Host starts with the extension loaded.
3. Open `sample/welcome.pseudo` (clean) or `sample/errors.pseudo` (intentional
   mistakes) to exercise diagnostics, hover, completion, etc.

You can also run the server standalone:

```bash
npm run build -w server && node server/out/server.js --stdio
```

## Making changes

- **New language construct / keyword**: add it to `lexicon.ts`, parse it in
  `core/parser.ts`, resolve/type it in `core/analyzer.ts` if needed, and add a
  parser + analyzer test. Completion/hover/coloring follow automatically.
- **New diagnostic**: extend the relevant `analyze…` function in the analyzer.
- **New LSP feature**: create `lsp/providers/<feature>.ts` implementing it
  against the `DocumentModel` (see existing providers), then register the
  handler in `server.ts`.
- **User-visible fixes that change behaviour**: document the decision in the
  README's "Intentional relaxations" section.
- **Renaming the extension**: the id is `publisher.name` from
  `client/package.json` (currently `fahrul.pseudo-lsp`) — remember to run
  `npm install` afterwards so `package-lock.json` stays in sync, or `npm ci`
  in CI will fail.

## Commit conventions

We use **Conventional Commits**:

```
<type>[optional scope]: <imperative subject>

[optional body]
```

Types used in this repo: `feat` · `fix` · `docs` · `chore` · `refactor` ·
`test` · `ci` · `build` · `perf`.

Examples:

```
feat: add REPEAT..UNTIL folding ranges
fix(analyzer): don't report implicit variables as unknown identifiers
docs: explain assignment operator relaxations
ci: cache node_modules between runs
```

Subjects are imperative, lowercase, and ≤ 72 characters (the pull request
title should follow the same rules).

## Branching and pull requests

- Work on a feature branch off `main`: `git checkout -b feat/your-change`.
- Keep PRs small and focused; one logical change per PR.
- Ensure the title is a conventional commit message.
- CI must be green: build, unit tests and the LSP smoke test.
- Mention in the PR description the guide section (e.g. "§7.2") any behaviour
  is based on, where helpful.

## Release process

Releases are cut from tags — no manual artifact uploads:

1. Bump the version in `client/package.json` and the root `package.json`
   (they must agree).
2. Tag and push:

   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```

3. CI builds, tests and packages `pseudo-lsp-<version>.vsix`, *verifies the tag
   matches the packaged version*, then creates a GitHub Release with the
   artifact and auto-generated release notes.

Tag names must match the extension version (`v0.1.1` ↔ version `0.1.1`) — a
mismatch fails the workflow on purpose. To release without a tag (local CI
check), `VERSION=x.y.z npm run package:vsix` stamps the version manually.

## Code style

- TypeScript with `strict: true` (see `tsconfig.base.json`) — no `any`
  escapes, no unused variables.
- Use the existing error-message phrasing where possible (diagnostics are user
  facing: short, actionable, and often cite the guide section).
- Keep modules single-purpose and functions small; prefer the existing
  composition patterns over new machinery.
- Public module headers carry a one-line JSDoc describing the responsibility

## License

By contributing you agree that your contributions are licensed under the same
[MIT](LICENSE) license as the rest of the project.

Happy hacking! 🚀