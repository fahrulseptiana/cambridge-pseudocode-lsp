/**
 * context.ts — shared helpers for locating tokens/words inside a document.
 * Used by hover, definition and completion providers (DRY).
 */

import { Position } from 'vscode-languageserver-types';
import { DocumentModel } from '../../core/analyzer';
import { Token, TokenKind } from '../../core/scanner';

/** Find the token covering an LSP position (exclusive end). */
export function tokenAtPosition(model: DocumentModel, pos: Position): Token | null {
  const match = (t: Token): boolean => {
    if (t.line !== pos.line || t.kind === TokenKind.Newline || t.kind === TokenKind.EndOfFile) return false;
    if (t.kind === TokenKind.Comment) return pos.character >= t.char && pos.character <= t.char + t.length;
    return pos.character >= t.char && pos.character < t.char + t.length;
  };
  for (const t of model.tokens) {
    if (t.line > pos.line) break;
    if (match(t)) return t;
  }
  return null;
}

/** The character before an LSP position ('' at start of file/line). */
export function textBeforePosition(text: string, pos: Position): string {
  const lines = text.split(/\r?\n/);
  const line = lines[pos.line] ?? '';
  return line.slice(0, pos.character);
}

/** Backwards scan for a `baseName` immediately before a trailing `.`. */
export function memberBaseAt(text: string, model: DocumentModel, pos: Position): string | null {
  const before = textBeforePosition(text, pos);
  if (!before.endsWith('.')) return null;
  const prefix = before.slice(0, -1);
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(prefix);
  return m ? m[0] : null;
}

/** All declaration name positions in the document (`line:char` → symbol). */
export function declarationPositions(model: DocumentModel): Set<string> {
  const set = new Set<string>();
  for (const s of model.allSymbols) set.add(`${s.namePos.line}:${s.namePos.char}`);
  return set;
}