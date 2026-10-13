# Cambridge Pseudocode (9618) — Language Server & VS Code Extension

A Visual Studio Code extension and LSP language server for the **Cambridge
International AS & A Level Computer Science 9618 pseudocode**, built directly
from the *"[Pseudocode Guide for Teachers](697401-2026-pseudocode-guide-for-teachers.pdf)"*
(use for exams in 2026, Version 1, Cambridge University Press & Assessment).

Works with **`.pseudo`** and **`.psc`** files.

---

## Features

| Feature | What you get |
|---|---|
| **Diagnostics** | Syntax errors (missing `ENDIF`, `THEN`, stray tokens…), unknown identifiers / procedures / functions, duplicate declarations, type mismatches (`INTEGER ← 3.5`), CONSTANT assignment, `NEXT` mismatch, incorrect `CALL` usage, built-in argument count/type checks |
| **Completion** | Structural snippets (`IF…THEN…ENDIF`, `FOR…TO…NEXT`, `CASE OF…ENDCASE`, `PROCEDURE`…), all keywords, data types, built-in functions, declared symbols, and OOP member completion after `object.` |
| **Hover** | Symbol kind + type, full procedure/function signatures, built-in function documentation (from the guide's §5.5/§5.6), class members & inheritance |
| **Go to Definition** | Variables, constants, procedures, functions, types, values, record fields, class members (`Ctrl+Click` works across the document) |
| **Outline** | Document symbols with a hierarchy (functions → parameters, classes → members, records → fields) |
| **Folding** | `IF/CASE/FOR/WHILE/REPEAT`, `PROCEDURE/FUNCTION/CLASS`, records, and comment blocks |
| **Formatting** | Re-indents to the guide's 3-space block style |
| **Semantic highlighting** | Color by *role* from the analyzer (variable, constant, type, class, parameter, property…), not just by regex keyword lists |
| **Syntax highlighting** | TextMate grammar fallback for when the server isn't running |

---

## Quick start (development)

```bash
npm install       # installs client + server (npm workspaces)
npm run build     # compiles client/ and server/
npm test          # unit tests (server core)
node scripts/lsp-smoke.mjs   # end-to-end LSP test over stdio
```

Press **F5** in VS Code with `client/.vscode/launch.json` selected — an
Extension Development Host opens with the `cambridge-pseudocode` extension
loaded. Open any `.pseudo` or `.psc` file; the language server starts
automatically.

> `sample/welcome.pseudo` (error-free showcase) and `sample/errors.pseudo`
> (intentionally broken) demonstrate every feature.

---

## Architecture

```
pseudo-code-lsp/
├── client/                         VS Code extension — LSP client only
│   ├── src/extension.ts            starts the server, wires transport
│   ├── syntaxes/…tmLanguage.json   TextMate grammar (fallback colours)
│   └── language-configuration.json  bracket/comment/indent rules
└── server/                         the language knowledge lives here
    ├── src/core/                   pure language layer (no LSP imports)
    │   ├── lexicon.ts              single source of truth: keywords/types/builtins
    │   ├── scanner.ts              text → tokens
    │   ├── ast.ts                  node types
    │   ├── parser.ts               recursive-descent, line-oriented grammar
    │   ├── analyzer.ts             scopes, symbols, types, diagnostics
    │   └── formatter.ts            block re-indentation
    ├── src/lsp/                    thin protocol adapters
    │   ├── service.ts              LanguageService seam (interface + cache)
    │   ├── convert.ts              position/range conversion
    │   └── providers/              one module per LSP feature
    └── src/server.ts               composition root (wires everything)
```

### SOLID

* **SRP** — The scanner, parser, analyzer, formatter and each provider have
  exactly one responsibility. `server.ts` never touches language rules; the
  `core/` layer never touches the LSP.
* **OCP** — New syntax is added by extending the grammar/lexicon; new LSP
  features are added as new provider modules without modifying existing ones.
* **LSP** — All AST nodes share the same base shape and are interchangeable
  wherever the parser emits nodes; providers operate on the shared
  `DocumentModel`, never on special cases.
* **ISP** — Providers depend on the narrow `LanguageService` interface, not on
  the server; the core layer exposes only `analyze()` + explicit functions.
* **DIP** — High-level providers call the `LanguageService` abstraction;
  `core/` modules never import from `lsp/`. Swapping storage, transport or
  hosting is a wiring change only.

### YAGNI

Only the constructs and diagnostics in the guide were implemented — no
workspace-wide analysis, no rename/refactoring, no project configuration,
no multi-file "smart" anything. The analyzer deliberately uses *weak,
literal-driven* type inference to avoid false positives on valid student code.

### DRY

The vocabulary lives **only** in `lexicon.ts` — the scanner, parser checks,
completion items, hover documentation and semantic-token classification all
derive from it. Symbol resolution data is produced **once** by the analyzer
(`nameResolutions`) and reused by hover, definition, semantic tokens and
completion, so the providers cannot drift from each other.

---

## Language coverage (per the guide)

* **Data types**: `INTEGER REAL CHAR STRING BOOLEAN DATE` (§2.1)
* **Declarations**: `DECLARE`, `CONSTANT` (literal-only values) (§2.4–2.5)
* **Assignment**: `←` (the guide's operator) plus `<-` and `:=` as
  keyboard-friendly typing aids (§2.6)
* **Arrays**: 1-D and 2-D, `ARRAY[1:30] OF STRING`, `ARRAY[1:3,1:3] OF CHAR`
  (§3)
* **User types**: enumerated `TYPE X = (…,)`, pointers `^INTEGER`, sets
  `SET OF` + `DEFINE`, records `TYPE X … ENDTYPE` (§4)
* **Selection**: `IF…THEN…ELSE…ENDIF`, `CASE OF…ENDCASE` with `OTHERWISE`
  and `TO` ranges (§6)
* **Iteration**: `FOR…TO…STEP…NEXT`, `REPEAT…UNTIL`, `WHILE…ENDWHILE` (§7)
* **Routines**: `PROCEDURE…ENDPROCEDURE`, `FUNCTION…RETURNS…ENDFUNCTION`,
  `BYREF`/`BYVAL` parameters (not for functions), `CALL`, `RETURN` (§8)
* **Files**: `OPENFILE … FOR READ|WRITE|APPEND|RANDOM`, `READFILE`,
  `WRITEFILE`, `CLOSEFILE`, `SEEK`, `GETRECORD`, `PUTRECORD`, `EOF()` (§9)
* **OOP**: `CLASS…ENDCLASS`, `INHERITS`, `SUPER`, `NEW` construction,
  `PUBLIC`/`PRIVATE` (§10)
* **Built-ins**: `RIGHT LENGTH MID LCASE UCASE INT RAND EOF` with arity and
  argument-type checking (§5.5–5.6, §9.1)
* **Operators**: `+ - * / DIV MOD`, `> < >= <= = <>`, `AND OR NOT`, `&`
  (string concat), `^` (pointer deref)
* **Comments**: `//` to end of line (§1.5); keywords are uppercase, identifiers
  mixed case with `_` allowed (§1.3, §2.3)

Differences from the guide are called out as **intentional relaxations**:

1. The assignment arrow is produced with `←` or typed with `<-` / `:=`.
2. Identifiers are **case-insensitive** (the guide recommends treating them
   that way, so `Countdown` and `CountDown` are the same name) — the LSP
   resolves names case-insensitively.
3. Assigning to an undeclared name / `INPUT` implicitly creates the variable
   with a gentle *hint* suggesting an explicit `DECLARE` (the guide says
   `DECLARE` is *good practice*, not a requirement — §2.4).

---

## Building a release (.vsix)

```bash
npm run package:vsix              # → build/cambridge-pseudocode-<version>.vsix
VERSION=1.2.3 npm run package:vsix # stamp a specific version (tag releases do this)
code --install-extension build/cambridge-pseudocode-<version>.vsix
```

The script builds the server and client, then assembles a **standalone extension
bundle** (`build/extension/`) that embeds the compiled language server
(`server/out`) and its own `node_modules`, so the produced `.vsix` works offline
and independent of this repository. The extension resolves the server from
inside itself (`<ext>/server/out/server.js`).

## CI: GitHub Actions

`.github/workflows/build-release.yml` runs on every push/PR:

1. `npm ci`, TypeScript build, unit tests, LSP smoke test (real stdio handshake)
2. **`.vsix` packaging** — on tag pushes the tag version (e.g. `v1.2.3`) is
   stamped into the bundle and the tag is verified against the packaged version
3. the `.vsix` is uploaded as a workflow artifact in all cases
4. **pushing a `v*` tag creates a GitHub Release** with the `.vsix` attached:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

## Testing & verification

* **Unit tests** (`npm test`): scanner, parser, analyzer and formatter —
  `server/test/*.test.ts`, run with Node's built-in test runner.
* **E2E smoke test** (`node scripts/lsp-smoke.mjs`): boots the compiled
  server, performs the LSP handshake over stdio with hand-rolled JSON-RPC
  frames, and asserts diagnostics, completion, hover, definition, outline,
  folding, formatting and semantic tokens.

```text
★ initialized
★ analysed welcome.pseudo
  diagnostics: 1 (0 errors)
  ✔ no parse or analysis errors in welcome.pseudo   ✔ … (all checks)
ALL SMOKE CHECKS PASSED
```

---

## License

MIT. The lexer/parser/AST and language rules are written for the Cambridge
9618 examination pseudocode as specified in the linked guide; the guide itself
is © Cambridge University Press & Assessment.