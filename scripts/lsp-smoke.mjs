#!/usr/bin/env node
/**
 * lsp-smoke.mjs — end-to-end smoke test.
 * Launches the compiled language server over stdio and drives it with
 * vanilla JSON-RPC messages (no SDK): initialize, didOpen, then requests for
 * diagnostics (via publishDiagnostics notification), completion, hover,
 * definition, documentSymbol, folding, formatting and semanticTokens.
 *
 * Usage: node scripts/lsp-smoke.mjs [path/to/file.pseudo]
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = process.argv[2] ?? path.join(root, 'sample', 'welcome.pseudo');

const server = spawn(process.execPath, [path.join(root, 'server', 'out', 'server.js'), '--stdio'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = Buffer.alloc(0);
let nextId = 0;
const pending = new Map();
const notifications = [];

function writeMessage(msg) {
  server.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

/** Request (expects a response with the given id). */
function send(method, params) {
  const id = ++nextId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  writeMessage(msg);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

/** Notification (id-less — JSON-RPC works exactly like the real client here). */
function notify(method, params) {
  writeMessage(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

function handle(data) {
  buf = Buffer.concat([buf, data]);
  for (;;) {
    const marker = buf.indexOf('\r\n\r\n');
    if (marker === -1) break;
    const header = buf.subarray(0, marker).toString();
    const m = /Content-Length: (\d+)/i.exec(header);
    if (!m) break;
    const length = Number(m[1]);
    const bodyStart = marker + 4;
    if (buf.length < bodyStart + length) break;
    const body = buf.subarray(bodyStart, bodyStart + length).toString();
    buf = buf.subarray(bodyStart + length);
    const msg = JSON.parse(body);
    if (msg.id !== undefined && msg.id !== null) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      notifications.push(msg.params);
    }
  }
}

server.stdout.on('data', handle);

const timers = [];
function sleep(ms) {
  return new Promise((r) => timers.push(setTimeout(r, ms)));
}

let failures = 0;
function check(cond, label, extra = '') {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

function lineIndexOf(text, needle, occurrence = 0) {
  const lines = text.split('\n');
  let found = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const col = lines[ln].indexOf(needle);
    if (col !== -1) {
      if (found === occurrence) return { line: ln, character: col };
      found += 1;
    }
  }
  return { line: 0, character: 0 };
}

try {
  await send('initialize', { processId: process.pid, rootUri: `file://${root.replace(/\\/g, '/')}`, capabilities: {} });
  console.log('★ initialized');
  // The LSP handshake requires the client to signal readiness.
  notify('initialized', {});

  const text = readFileSync(sample, 'utf8');
  const uri = `file://${sample.replace(/\\/g, '/')}`;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'pseudocode', version: 1, text },
  });
  await sleep(200);

  console.log(`★ analysed ${path.basename(sample)}`);

  const diag = notifications.find((n) => n.uri === uri);
  const errors = diag?.diagnostics.filter((d) => d.severity === 1).length ?? 0;
  const totalDiags = diag?.diagnostics.length ?? 0;
  console.log(`  diagnostics: ${totalDiags} (${errors} errors)`);
  check(errors === 0, 'no parse or analysis errors in welcome.pseudo', `found ${errors} errors`);

  const completion = await send('textDocument/completion', { textDocument: { uri }, position: { line: 0, character: 0 } });
  check(Array.isArray(completion) && completion.length > 20, 'completion returns many items', `${completion?.length} items`);

  // Hover on the FUNCTION Max declaration name
  const fnPos = lineIndexOf(text, 'FUNCTION Max(');
  const h2 = await send('textDocument/hover', { textDocument: { uri }, position: { line: fnPos.line, character: fnPos.character + 'FUNCTION '.length } });
  const hoverText = h2?.contents?.value ?? '';
  check(h2 && hoverText.includes('Max') && hoverText.includes('RETURNS'), 'hover on function Max', JSON.stringify(h2));

  // definition: jump from CALL Greet(…) back to PROCEDURE Greet
  const callPos = lineIndexOf(text, 'CALL Greet(');
  const usePos = { line: callPos.line, character: callPos.character + 'CALL '.length };
  const def = await send('textDocument/definition', { textDocument: { uri }, position: usePos });
  check(def && def.uri === uri && def.range.start.line < usePos.line, 'definition resolves to PROCEDURE Greet', JSON.stringify(def));

  const symbols = await send('textDocument/documentSymbol', { textDocument: { uri } });
  const kinds = symbols.map((s) => s.kind);
  check(Array.isArray(symbols) && symbols.length >= 6, 'document symbols present (outline)', `${symbols?.length} symbols`);

  const folding = await send('textDocument/foldingRange', { textDocument: { uri } });
  check(Array.isArray(folding) && folding.length >= 10, 'folding ranges present', `${folding?.length} ranges`);

  const fmt = await send('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 3, insertSpaces: true } });
  check(Array.isArray(fmt) && fmt.length > 0, 'formatting edits produced', `${fmt?.length} edits`);

  const sem = await send('textDocument/semanticTokens/full', { textDocument: { uri } });
  check(sem && Array.isArray(sem.data) && sem.data.length > 0, 'semantic tokens produced', `${sem?.data?.length} ints`);

  // --- diagnostics sanity on the intentionally-broken file --------------------
  const broken = path.join(root, 'sample', 'errors.pseudo');
  const brokenText = readFileSync(broken, 'utf8');
  const brokenUri = `file://${broken.replace(/\\/g, '/')}`;
  notify('textDocument/didOpen', { textDocument: { uri: brokenUri, languageId: 'pseudocode', version: 1, text: brokenText } });
  await sleep(200);
  const bd = notifications.filter((n) => n.uri === brokenUri).pop();
  const bErrors = bd?.diagnostics.filter((d) => d.severity === 1).length ?? 0;
  console.log(`  errors.pseudo diagnostics: ${bd?.diagnostics.length ?? 0} (${bErrors} errors)`);
  check(bErrors >= 7, 'errors.pseudo reports real mistakes');
  check((bd?.diagnostics ?? []).some((d) => /does not match the loop variable/i.test(d.message)), 'NEXT mismatch diagnostic');

  await send('shutdown', null);
  server.stdin.end();
  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('\nSMOKE TEST CRASHED:', err.message);
  process.exit(1);
} finally {
  for (const t of timers) clearTimeout(t);
  server.kill();
}