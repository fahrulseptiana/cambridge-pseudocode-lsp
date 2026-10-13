/**
 * hover.ts — rich hover documentation for symbols, built-ins and data types.
 * Renders markdown from the analyzer's symbols and the lexicon's docs.
 */

import { Hover, MarkupKind, Position } from 'vscode-languageserver-types';
import { DocumentModel, SymbolInfo, typeNameOf } from '../../core/analyzer';
import { BUILTIN_FUNCTIONS, isBuiltinType } from '../../core/lexicon';
import { Token, TokenKind, wordKind } from '../../core/scanner';
import { toRange } from '../convert';
import { tokenAtPosition } from './context';

export function provideHover(model: DocumentModel, pos: Position): Hover | null {
  const token = tokenAtPosition(model, pos);
  if (!token || token.kind !== TokenKind.Word) return null;

  const range = toRange({ start: { line: token.line, char: token.char }, end: { line: token.line, char: token.char + token.length } });

  // Resolve the word to a symbol (identifier usage or declaration).
  const symbol = model.nameResolutions.get(`${token.line}:${token.char}`);
  if (symbol) {
    return { contents: { kind: MarkupKind.Markdown, value: renderSymbol(symbol) }, range };
  }

  const kind = wordKind(token);
  if (kind === 'builtin') {
    const b = BUILTIN_FUNCTIONS[token.value];
    const sig = `${b.name}(${b.params.map((p) => `${p.name} : ${p.type ?? 'File'}`).join(', ')}) RETURNS ${b.returns ?? 'value'}`;
    return { contents: { kind: MarkupKind.Markdown, value: `**\`${sig}\`**\n\n${b.doc}` }, range };
  }
  if (kind === 'type') {
    return { contents: { kind: MarkupKind.Markdown, value: `**${token.value}** — built-in data type (guide §2.1).` }, range };
  }
  return null;
}

// ------------------------------------------------------------------- render

function kindLabel(s: SymbolInfo): string {
  switch (s.kind) {
    case 'variable': return 'Variable';
    case 'constant': return 'Constant';
    case 'procedure': return 'Procedure';
    case 'function': return 'Function';
    case 'parameter': return 'Parameter';
    case 'loop': return 'Loop variable';
    case 'property': return 'Property';
    case 'field': return 'Field';
    case 'type': return 'User-defined data type';
    case 'class': return 'Class';
    case 'enum': return 'Enumerated value';
    default: return s.kind;
  }
}

function renderSymbol(s: SymbolInfo): string {
  const head: string[] = [];
  switch (s.kind) {
    case 'variable':
    case 'loop':
    case 'parameter':
    case 'property':
    case 'field':
      head.push(`**${s.name}** \`:\` ${code(s.typeText || 'unknown')}`);
      break;
    case 'constant':
      head.push(`**${s.name}** (constant)`);
      break;
    case 'procedure':
    case 'function': {
      const node = s.declNode;
      const params =
        node && (node.kind === 'ProcedureDecl' || node.kind === 'FunctionDecl')
          ? node.params.map((p) => `${p.name} : ${typeNameOf(p.type) || '…'}`).join(', ')
          : '…';
      head.push(`**\`${s.name}(${params})\`**${s.kind === 'function' ? ` RETURNS ${code(s.typeText)}` : ''}`);
      head.push(kindLabel(s));
      break;
    }
    case 'type': {
      const node = s.declNode;
      if (node?.kind === 'TypeDecl') {
        const desc =
          node.form === 'enum' ? 'Enumerated' :
          node.form === 'pointer' ? 'Pointer' :
          node.form === 'set' ? 'Set' : 'Record';
        head.push(`**${s.name}** — user-defined ${desc} data type (guide §4.1)`);
      } else {
        head.push(`**${s.name}** — ${kindLabel(s)}`);
      }
      break;
    }
    case 'class':
      head.push(`**${s.name}**${s.inherits ? ` inherits \`${s.inherits}\`` : ''} — class (guide §10)`);
      break;
    case 'enum':
      head.push(`**${s.name}** — value of the **${s.typeText}** enumerated type`);
      break;
    default:
      head.push(`**${s.name}** — ${kindLabel(s)}`);
  }

  const docLines = [...head];
  if (s.members.size > 0) {
    docLines.push('', '**Members**');
    for (const [name, m] of s.members) {
      docLines.push(`- \`${name}\` — ${m.kind}${m.typeText ? ` : ${m.typeText}` : ''}`);
    }
  }
  return docLines.join('\n');
}

function code(x: string): string {
  return `\`${x}\``;
}