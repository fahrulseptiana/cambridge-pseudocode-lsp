/**
 * documentSymbols.ts — the outline view: a hierarchy mirroring the document's
 * declarations (procedures → parameters, classes → members, records → fields).
 */

import { DocumentSymbol, SymbolKind } from 'vscode-languageserver-types';
import { DocumentModel, SymbolInfo, typeNameOf } from '../../core/analyzer';
import { toRange } from '../convert';

export function provideDocumentSymbols(model: DocumentModel): DocumentSymbol[] {
  return topLevel(model).map(toDocumentSymbol);
}

interface Flat {
  name: string;
  kind: SymbolKind;
  detail: string;
  range: { start: { line: number; char: number }; end: { line: number; char: number } };
  selection: { start: { line: number; char: number }; end: { line: number; char: number } };
  children: Flat[];
}

function topLevel(model: DocumentModel): Flat[] {
  const result: Flat[] = [];
  const seen = new Set<string>();
  for (const s of model.allSymbols) {
    // Enum values are children of their TYPE symbol, not separate outline roots
    // (they live in the global scope so bare names like `Spring` resolve).
    if (s.kind === 'enum') continue;
    // Top-level declarations only (duplicates already reported by the analyzer).
    const key = `${s.namePos.line}:${s.namePos.char}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.scope && s.scope.parent === null) {
      const f = symbolToFlat(s);
      if (f) result.push(f);
    }
  }
  return result;
}

function symbolToFlat(s: SymbolInfo): Flat | null {
  // LSP requires selectionRange ⊆ range. Symbols with zero-width declaration
  // ranges (enum values, implicitly declared variables) get their range
  // widened to at least cover the name so the outline stays valid.
  const selection = { start: s.namePos, end: { line: s.namePos.line, char: s.namePos.char + s.name.length } };
  const range = { start: s.declRange.start, end: isAfter(s.declRange.end, selection.end) ? s.declRange.end : selection.end };
  const base: Flat = {
    name: s.name,
    kind: flatKind(s),
    detail: detailOf(s),
    range,
    selection,
    children: [],
  };

  const node = s.declNode;
  if (node) {
    switch (node.kind) {
      case 'ProcedureDecl':
      case 'FunctionDecl':
        base.children = node.params.map((p) => ({
          name: p.name,
          kind: SymbolKind.Variable,
          detail: typeNameOf(p.type),
          range: { start: p.start, end: p.end },
          selection: { start: p.namePos, end: { line: p.namePos.line, char: p.namePos.char + p.name.length } },
          children: [],
        }));
        break;
      case 'ClassDecl':
        base.children = node.members
          .filter((m) => m.kind === 'VarDecl' || m.kind === 'ConstDecl')
          .map((m) => ({
            name: m.name,
            kind: m.kind === 'ConstDecl' ? SymbolKind.Constant : SymbolKind.Property,
            detail: m.kind === 'ConstDecl' ? 'constant' : typeNameOf(m.type),
            range: { start: m.start, end: m.end },
            selection: { start: m.namePos, end: { line: m.namePos.line, char: m.namePos.char + m.name.length } },
            children: [],
          }));
        break;
      case 'TypeDecl':
        if (node.form === 'record' && node.recordFields) {
          base.children = node.recordFields.map((f) => ({
            name: f.name,
            kind: SymbolKind.Field,
            detail: typeNameOf(f.type),
            range: { start: f.start, end: f.end },
            selection: { start: f.namePos, end: { line: f.namePos.line, char: f.namePos.char + f.name.length } },
            children: [],
          }));
        } else if (node.form === 'enum' && node.enumValues) {
          base.children = node.enumValues.map((v) => {
            const extent = { start: v.namePos, end: { line: v.namePos.line, char: v.namePos.char + v.name.length } };
            return {
              name: v.name,
              kind: SymbolKind.EnumMember,
              detail: 'enum value',
              range: extent,
              selection: extent,
              children: [],
            };
          });
        }
        break;
    }
  }
  return base;
}

function flatKind(s: SymbolInfo): SymbolKind {
  switch (s.kind) {
    case 'procedure': return SymbolKind.Function;
    case 'function': return SymbolKind.Function;
    case 'constant': return SymbolKind.Constant;
    case 'class': return SymbolKind.Class;
    case 'property': return SymbolKind.Property;
    case 'type': return SymbolKind.Struct;
    case 'variable': return SymbolKind.Variable;
    default: return SymbolKind.Variable;
  }
}

function detailOf(s: SymbolInfo): string {
  switch (s.kind) {
    case 'procedure': return 'PROCEDURE';
    case 'function': return `FUNCTION → ${s.typeText || '…'}`;
    case 'constant': return `constant = ${s.typeText}`;
    case 'variable': return s.typeText;
    case 'property': return s.typeText;
    case 'type': {
      const node = s.declNode;
      return node?.kind === 'TypeDecl' ? node.form.toUpperCase() : 'type';
    }
    case 'class': return s.inherits ? `CLASS inherits ${s.inherits}` : 'CLASS';
    default: return s.kind;
  }
}

function toDocumentSymbol(f: Flat): DocumentSymbol {
  return {
    name: f.name,
    kind: f.kind,
    detail: f.detail,
    range: toRange(f.range),
    selectionRange: toRange(f.selection),
    children: f.children.map(toDocumentSymbol),
  };
}

/** True when position `a` is at or after position `b` (line-major). */
function isAfter(a: { line: number; char: number }, b: { line: number; char: number }): boolean {
  return a.line > b.line || (a.line === b.line && a.char >= b.char);
}