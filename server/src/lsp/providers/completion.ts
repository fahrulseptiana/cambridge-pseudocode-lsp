/**
 * completion.ts — keyword/type/builtin snippets + declared symbols + OOP
 * member access (`object.`) — all driven by the same data sources the parser
 * and analyzer use (lexicon.ts and the DocumentModel), so they cannot drift.
 */

import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver-types';
import { DocumentModel, SymbolInfo, typeNameOf } from '../../core/analyzer';
import { BUILTIN_FUNCTIONS, COMPLETION_KEYWORDS, DATA_TYPES } from '../../core/lexicon';
import { memberBaseAt } from './context';

export function provideCompletion(docText: string, pos: Position, model: DocumentModel): CompletionItem[] {
  const base = memberBaseAt(docText, model, pos);
  if (base) return memberCompletion(model, base);
  return generalCompletion(model);
}

// --------------------------------------------------------------- general

function generalCompletion(model: DocumentModel): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Declared symbols of the current document (variables, procedures, …).
  items.push(...documentSymbolsCompletion(model));

  // Keywords with snippets (structure templates).
  for (const k of COMPLETION_KEYWORDS) {
    items.push({
      label: k.label,
      kind: CompletionItemKind.Snippet,
      detail: 'pseudocode keyword',
      documentation: k.doc,
      insertText: k.insertText ?? k.label,
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: 'a-keyword',
    });
  }
  // Data types.
  for (const t of DATA_TYPES) {
    items.push({
      label: t,
      kind: CompletionItemKind.TypeParameter,
      detail: 'built-in data type',
      documentation: `Built-in data type: ${t}`,
      sortText: 'b-type',
    });
  }
  // Built-in functions with signatures.
  for (const b of Object.values(BUILTIN_FUNCTIONS)) {
    items.push({
      label: b.name,
      kind: CompletionItemKind.Function,
      detail: `${signature(b.name)} RETURNS ${b.returns ?? 'value'}`,
      documentation: b.doc,
      sortText: 'c-builtin',
    });
  }
  return items;
}

function signature(name: string): string {
  const b = BUILTIN_FUNCTIONS[name];
  return `${name}(${b.params.map((p) => `${p.name} : ${p.type ?? 'File'}`).join(', ')})`;
}

function documentSymbolsCompletion(model: DocumentModel): CompletionItem[] {
  return model.allSymbols
    .filter((s) => s.declNode !== null || s.kind === 'enum')
    .map((s) => ({
      label: s.name,
      kind: completionKind(s),
      detail: `${s.kind}: ${s.typeText || s.kind}`,
      sortText: '0-symbol',
      documentation: symbolDetail(s),
    }));
}

function completionKind(s: SymbolInfo): CompletionItemKind {
  switch (s.kind) {
    case 'procedure': return CompletionItemKind.Function;
    case 'function': return CompletionItemKind.Function;
    case 'constant': return CompletionItemKind.Constant;
    case 'class': return CompletionItemKind.Class;
    case 'type': return CompletionItemKind.Interface;
    case 'enum': return CompletionItemKind.EnumMember;
    case 'parameter': return CompletionItemKind.Variable;
    case 'loop': return CompletionItemKind.Variable;
    case 'property': return CompletionItemKind.Property;
    case 'field': return CompletionItemKind.Field;
    default: return CompletionItemKind.Variable;
  }
}

function symbolDetail(s: SymbolInfo): string {
  if (s.kind === 'procedure' || s.kind === 'function') {
    const node = s.declNode;
    if (node && (node.kind === 'ProcedureDecl' || node.kind === 'FunctionDecl')) {
      const params = node.params.map((p) => `${p.name} : ${typeNameOf(p.type) || '…'}`).join(', ');
      return `${s.name}(${params})${s.kind === 'function' ? ` RETURNS ${s.typeText}` : ''}`;
    }
  }
  return `${s.kind}: ${s.typeText || s.kind}`;
}

// ------------------------------------------------- object member completion

function memberCompletion(model: DocumentModel, base: string): CompletionItem[] {
  const sym = findSymbolByName(model, base);
  if (!sym) return [];
  const items: CompletionItem[] = [];
  for (const [name, member] of sym.members) {
    const isCallable = member.kind === 'procedure' || member.kind === 'function';
    items.push({
      label: name,
      kind: isCallable ? CompletionItemKind.Method : CompletionItemKind.Property,
      detail: member.typeText || member.kind,
      insertText: isCallable ? `${name}()` : name,
      documentation: `${member.kind}: ${member.typeText || 'member'}`,
      sortText: 'member',
    });
  }
  return items;
}

function findSymbolByName(model: DocumentModel, name: string): SymbolInfo | undefined {
  let fallback: SymbolInfo | undefined;
  for (const s of model.allSymbols) {
    if (s.name !== name) continue;
    if (s.kind === 'parameter' || s.kind === 'variable' || s.kind === 'loop') {
      return s; // instance-based resolution is the common case
    }
    if (!fallback) fallback = s;
  }
  return fallback;
}