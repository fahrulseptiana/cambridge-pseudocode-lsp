#!/usr/bin/env node
/**
 * server.ts — composition root of the language server.
 *
 * Owns only *wiring*: creates the LSP connection, keeps the per-document
 * LanguageService, and forwards each protocol request to its dedicated
 * provider module. No language knowledge lives here.
 */

import {
  createConnection,
  FoldingRangeRequest,
  InitializeResult,
  SemanticTokensRequest,
  ServerCapabilities,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LanguageService, MemoryDocumentService } from './lsp/service';
import { provideCompletion } from './lsp/providers/completion';
import { provideDefinition } from './lsp/providers/definition';
import { provideDiagnostics } from './lsp/providers/diagnostics';
import { provideDocumentSymbols } from './lsp/providers/documentSymbols';
import { provideFoldingRanges } from './lsp/providers/folding';
import { provideFormatting } from './lsp/providers/formatting';
import { provideHover } from './lsp/providers/hover';
import { provideSemanticTokens, SEMANTIC_TOKEN_TYPES } from './lsp/providers/semanticTokens';

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
const service: LanguageService = new MemoryDocumentService();

// ------------------------------------------------------------ capabilities

const capabilities: ServerCapabilities = {
  textDocumentSync: TextDocumentSyncKind.Full,
  completionProvider: {
    resolveProvider: false,
    triggerCharacters: ['.'],
    allCommitCharacters: ['\t'],
  },
  hoverProvider: true,
  definitionProvider: true,
  documentSymbolProvider: true,
  foldingRangeProvider: true,
  documentFormattingProvider: true,
  semanticTokensProvider: {
    legend: { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: ['declaration'] },
    full: true,
  },
};

connection.onInitialize((_params): InitializeResult => {
  return { capabilities };
});

// -------------------------------------------------------------- diagnostics

function refresh(uri: string): void {
  const model = service.getModel(uri);
  if (!model) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }
  connection.sendDiagnostics({ uri, diagnostics: provideDiagnostics(model) });
}

documents.onDidOpen((e) => {
  service.analyzeAndCache(e.document);
  refresh(e.document.uri);
});
documents.onDidChangeContent((e) => {
  service.analyzeAndCache(e.document);
  refresh(e.document.uri);
});
documents.onDidClose((e) => {
  service.drop(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ------------------------------------------------------------ LSP handlers

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideCompletion(doc.getText(), params.position, model);
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideHover(model, params.position);
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideDefinition(model, doc.uri, params.position);
});

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideDocumentSymbols(model);
});

connection.onRequest(FoldingRangeRequest.type, (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideFoldingRanges(model);
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return provideFormatting(doc);
});

connection.onRequest(SemanticTokensRequest.type, (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const model = service.analyzeAndCache(doc);
  return provideSemanticTokens(model);
});

// ------------------------------------------------------------------ startup

documents.listen(connection);
connection.listen();

console.error('[cambridge-pseudocode] language server started (node ' + process.version + ')');