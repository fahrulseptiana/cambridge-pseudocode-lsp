/**
 * extension.ts — VS Code client: starts the language server process and
 * forwards LSP messages. The client knows nothing about the pseudocode
 * language itself; all language behaviour lives in the server (DIP/SRP).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { commands, ExtensionContext, languages, window } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  State,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

/**
 * Locate the compiled language server:
 *  - development:  <repo>/server/out/server.js  (sibling of the extension dir)
 *  - packaged .vsix: <extension>/server/out/server.js  (bundled by package-vsix)
 */
function resolveServerModule(context: ExtensionContext): string {
  const devServer = path.join(context.extensionPath, '..', 'server', 'out', 'server.js');
  if (fs.existsSync(devServer)) return devServer;
  return context.asAbsolutePath(path.join('server', 'out', 'server.js'));
}

export function activate(context: ExtensionContext): void {
  const serverModule = resolveServerModule(context);

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio, options: { execArgv: ['--inspect=6009'] } },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: 'pseudocode' }],
    synchronize: { configurationSection: 'pseudocode' },
    outputChannelName: 'Cambridge Pseudocode LSP',
    diagnosticCollectionName: 'pseudocode',
  };

  client = new LanguageClient('cambridgePseudocode', 'Cambridge Pseudocode (9618)', serverOptions, clientOptions);
  client.start();

  // Maintenance commands (useful during development).
  context.subscriptions.push(
    commands.registerCommand('cambridgePseudocode.restartServer', async () => {
      if (client && client.state === State.Running) await client.restart();
      else window.showInformationMessage('Pseudocode language server is not running.');
    }),
    commands.registerCommand('cambridgePseudocode.reportIssues', () => {
      const uri = window.activeTextEditor?.document.uri;
      if (!uri) {
        window.showInformationMessage('No active document.');
        return;
      }
      const diagnostics = languages.getDiagnostics(uri);
      if (diagnostics.length === 0) {
        window.showInformationMessage('No pseudocode issues in the active document.');
      } else {
        window.showInformationMessage(`${diagnostics.length} issue(s) in the active document — see the Problems panel.`);
      }
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}