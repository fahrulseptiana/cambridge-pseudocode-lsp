/**
 * formatter.ts — line re-indentation for Cambridge 9618 pseudocode.
 *
 * The guide states lines are indented (usually by three spaces) to show they
 * are contained in a previous statement (section 1.2). This formatter rebuilds
 * indentation from the syntax structure using only its own lexing (DRY: it
 * leverages scanner.ts; no grammar knowledge beyond block openers/closers).
 */

import { CLOSING_KEYWORDS, OPENING_KEYWORDS } from './lexicon';
import { Token, TokenKind, scan } from './scanner';

export interface FormattingEdit {
  /** 0-based line that should be re-indented. */
  line: number;
  /** New leading whitespace for that line. */
  indent: string;
}

const INDENT_UNIT = '   '; // three spaces per the guide

/** Compute the desired indentation for every physical line. */
export function computeIndents(text: string): FormattingEdit[] {
  const tokens = scan(text);
  const lines: Token[][] = groupLines(tokens);
  const edits: FormattingEdit[] = [];
  let depth = 0;

  for (let ln = 0; ln < lines.length; ln++) {
    const lineTokens = lines[ln];
    const first = lineTokens[0];
    if (!first || first.kind === TokenKind.EndOfFile) continue;

    // Only (re-)indent the first significant token of the line; skip cosmetic lines.
    if (first.kind === TokenKind.Newline) continue;
    if (first.kind === TokenKind.Comment) {
      // Keep comments aligned with the surrounding code.
      edits.push({ line: ln, indent: INDENT_UNIT.repeat(Math.max(0, depth)) });
      continue;
    }

    const word = first.kind === TokenKind.Word ? first.value : '';
    let lineDepth = depth;

    // Closing keywords sit one level out:  ENDIF / NEXT / UNTIL / ELSE / …
    if (CLOSING_KEYWORDS.has(word)) {
      lineDepth = Math.max(0, depth - 1);
      if (word !== 'ELSE') depth = Math.max(0, depth - 1);
    }
    // ELSE/OTHERWISE stay inside their own block; the next line continues the body.

    edits.push({ line: ln, indent: INDENT_UNIT.repeat(lineDepth) });

    if (OPENING_KEYWORDS.has(word)) {
      if (word === 'TYPE' && !isRecordTypeLine(lineTokens)) continue; // enumerated/set/pointer
      depth += 1;
    }
  }
  return edits;
}

/** A record TYPE line is `TYPE <identifier>` alone (body follows until ENDTYPE). */
function isRecordTypeLine(tokens: Token[]): boolean {
  const meaningful = tokens.filter((t) => t.kind !== TokenKind.Comment);
  // TYPE + one identifier + (end of line / trailing comment)
  if (meaningful.length === 2) return true;
  if (meaningful.length === 3 && meaningful[2].kind === TokenKind.Comment) return true;
  return false;
}

/** Group tokens into physical lines (leading token per line). */
function groupLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (t.kind === TokenKind.Newline) {
      lines.push(current);
      current = [];
    } else if (t.kind !== TokenKind.EndOfFile) {
      current.push(t);
    }
  }
  lines.push(current);
  return lines;
}

/** Produce the fully re-indented document text (for preview/tests). */
export function formatText(text: string): string {
  const edits = computeIndents(text);
  const src = text.split(/\r?\n/);
  for (const e of edits) {
    if (e.line >= src.length) continue;
    const stripped = src[e.line].trimStart();
    if (stripped === '' && !isCodeLine(text, e.line)) continue;
    src[e.line] = e.indent + stripped;
  }
  return src.join('\n');
}

function isCodeLine(text: string, line: number): boolean {
  const src = text.split(/\r?\n/);
  return src[line]?.trim().length > 0;
}