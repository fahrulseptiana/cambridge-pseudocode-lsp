#!/usr/bin/env node
/**
 * package-vsix.mjs — assembles a self-contained .vsix and runs vsce.
 *
 * The extension's runtime server (client/src/extension.ts) expects the
 * compiled language server inside the extension at <ext>/server/out/server.js,
 * so this script:
 *   1. builds the server and client (TypeScript),
 *   2. assembles a STANDALONE extension bundle under build/extension/
 *      (out/, syntaxes/, configuration, embedded server, own node_modules —
 *      a real npm package independent of this workspace, which vsce can scan
 *      without tripping over hoisted/workspace dependency paths),
 *   3. optionally stamps the version from $VERSION (CI sets it from the tag),
 *   4. packages the bundle with @vscode/vsce into build/*.vsix.
 *
 * Local use:   npm run package:vsix                 → build/cambridge-pseudocode-<ver>.vsix
 * CI release:  VERSION=1.2.3 npm run package:vsix   → build/cambridge-pseudocode-1.2.3.vsix
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'client');
const buildDir = path.join(root, 'build');
const bundleDir = path.join(buildDir, 'extension');

const NODE = process.execPath;
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const VSCE = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\n✖ '${path.basename(cmd)} ${args.join(' ')}' failed with exit code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

// 1. Build everything.
console.log('\n▶ Building server and client…');
run(NODE, [TSC, '-p', path.join(root, 'server', 'tsconfig.json')], root);
run(NODE, [TSC, '-p', path.join(root, 'client', 'tsconfig.json')], root);

// 2. Assemble a standalone extension bundle.
console.log('▶ Assembling extension bundle…');
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

const serverOut = path.join(root, 'server', 'out');
if (!existsSync(serverOut)) {
  console.error(`✖ Server output missing: ${serverOut} (run the build step first)`);
  process.exit(1);
}
cpSync(serverOut, path.join(bundleDir, 'server', 'out'), { recursive: true });

for (const rel of [
  'package.json',
  '.vscodeignore',
  'README.md',
  'LICENSE',
  'language-configuration.json',
  'syntaxes',
  'out',
]) {
  cpSync(path.join(clientDir, rel), path.join(bundleDir, rel), { recursive: true });
}

// 3. Optional version stamping (CI passes the git tag, e.g. VERSION=1.2.3).
const version = process.env.VERSION;
if (version) {
  const pkgPath = path.join(bundleDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== version) {
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`▶ Stamped extension version: ${version}`);
  }
}

// 4. Give the bundle its own node_modules (it is a normal npm package now,
//    so vsce's dependency scan sees only local packages — no hoisting).
console.log('▶ Installing production dependencies into the bundle…');
installBundleDeps(bundleDir);

// 5. Package with vsce.
console.log('▶ Packaging .vsix (vsce)…');
const pkg = JSON.parse(readFileSync(path.join(bundleDir, 'package.json'), 'utf8'));
const vsix = path.join(buildDir, `${pkg.name}-${pkg.version}.vsix`);
rmSync(vsix, { force: true });
run(NODE, [VSCE, 'package'], bundleDir);
cpSync(path.join(bundleDir, `${pkg.name}-${pkg.version}.vsix`), vsix);

console.log(`\n✔ Created ${vsix}`);
console.log('  Install with:  code --install-extension ' + vsix);

/** Install the bundle's production deps (npm is a sibling of node, not a project dep). */
function installBundleDeps(cwd) {
  const args = ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'];
  // Preferred: node's own npm-cli.js (works for vanilla Node and setup-node toolchains).
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(npmCli)) {
    const res = spawnSync(NODE, [npmCli, ...args], { cwd, stdio: 'inherit' });
    if (res.status !== 0) process.exit(res.status ?? 1);
    return;
  }
  // Fallback: npm/npm.cmd on PATH.
  const res = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}