/**
 * convert.ts — position/range translation between the core layer's plain
 * `{ line, char }` positions and the LSP's `{ line, character }` types.
 * (A single, tiny adapter — nothing else in the codebase knows both shapes.)
 */

import { Position, Range } from 'vscode-languageserver-types';
import { Pos } from '../core/ast';

export function toPosition(p: Pos): Position {
  return { line: p.line, character: p.char };
}

export function toRange(r: { start: Pos; end: Pos }): Range {
  return { start: toPosition(r.start), end: toPosition(r.end) };
}