/**
 * scanner.ts — converts pseudocode source text into a flat token stream.
 *
 * Responsible only for *lexing* (SRP). The parser works purely on this token
 * stream; classification of words (keyword/type/builtin/identifier) is
 * delegated to lexicon.ts so there is a single source of truth.
 */

import { classifyWord } from './lexicon';

export enum TokenKind {
  /** A word: keyword, identifier, data type, builtin function name… (see classifyWord). */
  Word,
  /** Integer literal, e.g. 5, -3 (the minus is lexed as an operator). */
  Integer,
  /** Real literal, always with a digit on each side of the point: 4.7, 0.0. */
  Real,
  /** Date literal in the dd/mm/yyyy format (section 2.2). */
  DateLiteral,
  /** Double-quoted string literal: "Hello", "" (section 2.2). */
  StringLiteral,
  /** Single-quoted character literal: 'A' (section 2.2). */
  CharLiteral,
  /** The assignment operator: "←" (also accepts "<-" or ":=" as keyboard fallbacks). */
  Arrow,
  /** An operator or punctuation character: + - * / DIV MOD ^ & = < > <> <= >= ( ) [ ] , : . … */
  Operator,
  /** End-of-line comment: //… (section 1.5) — kept for highlighting; parser skips them. */
  Comment,
  /** End of a physical line — statically significant in this line-based language. */
  Newline,
  /** A lexing failure (e.g. unterminated string). value holds the message. */
  Error,
  EndOfFile,
}

export interface Token {
  kind: TokenKind;
  /** The lexeme text (for Error tokens: the human-readable message). */
  value: string;
  /** 0-based line. */
  line: number;
  /** 0-based character column. */
  char: number;
  /** Length in characters. */
  length: number;
  /** Absolute offset in the source. */
  offset: number;
}

// Operator / punctuation characters recognised by the language (excluding words like DIV).
const OPERATORS = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', '[', ']', ',', ':', '.']);

const ASSIGNMENT_ARROW = '←';

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}
function isWordChar(c: string): boolean {
  return c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isDigit(c);
}
function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** Tokenize pseudocode source text. */
export function scan(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  let lineStart = 0;

  const push = (kind: TokenKind, start: number, end: number): void => {
    tokens.push({
      kind,
      value: source.slice(start, end),
      line,
      char: start - lineStart,
      length: end - start,
      offset: start,
    });
  };

  // End of file marker.
  const eof = (): Token => ({
    kind: TokenKind.EndOfFile,
    value: '',
    line,
    char: i - lineStart,
    length: 0,
    offset: i,
  });

  while (i < source.length) {
    const c = source[i];

    // Line breaks
    if (c === '\n') {
      tokens.push({ kind: TokenKind.Newline, value: '\n', line, char: i - lineStart, length: 1, offset: i });
      i += 1;
      line += 1;
      lineStart = i;
      continue;
    }
    if (c === '\r') {
      // Normalise \r\n to a single newline token.
      const end = i + 1 < source.length && source[i + 1] === '\n' ? i + 2 : i + 1;
      tokens.push({ kind: TokenKind.Newline, value: '\n', line, char: i - lineStart, length: end - i, offset: i });
      i = end;
      line += 1;
      lineStart = i;
      continue;
    }

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i += 1;
      continue;
    }

    const start = i;

    // Comments  //
    if (c === '/' && i + 1 < source.length && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
      push(TokenKind.Comment, start, i);
      continue;
    }

    // Strings  "…"  (may be empty)
    if (c === '"') {
      i += 1;
      let closed = false;
      while (i < source.length && source[i] !== '"' && source[i] !== '\n' && source[i] !== '\r') i += 1;
      if (i < source.length && source[i] === '"') {
        closed = true;
        i += 1;
      }
      if (closed) {
        push(TokenKind.StringLiteral, start, i);
      } else {
        // unterminated: consume to end of line so recovery is clean
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
        tokens.push({ kind: TokenKind.Error, value: 'Unterminated string literal', line, char: start - lineStart, length: i - start, offset: start });
      }
      continue;
    }

    // Character literals  'A'
    if (c === "'") {
      if (i + 2 < source.length && source[i + 2] === "'") {
        i += 3;
        push(TokenKind.CharLiteral, start, i);
        continue;
      }
      // Grab until closing quote or end of line.
      i += 1;
      while (i < source.length && source[i] !== "'" && source[i] !== '\n' && source[i] !== '\r') i += 1;
      const closed = i < source.length && source[i] === "'";
      if (closed) i += 1;
      const body = source.slice(start + 1, closed ? i - 1 : i);
      if (closed && body.length === 1) {
        push(TokenKind.CharLiteral, start, i);
      } else {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
        tokens.push({
          kind: TokenKind.Error,
          value: body.length === 0 ? 'Empty character literal (expected one character)' : 'Character literal must contain exactly one character',
          line,
          char: start - lineStart,
          length: i - start,
          offset: start,
        });
      }
      continue;
    }

    // Assignment arrows:  ←   |   <-   |   :=
    if (c === ASSIGNMENT_ARROW) {
      i += 1;
      push(TokenKind.Arrow, start, i);
      continue;
    }
    if (c === '<' && i + 1 < source.length && source[i + 1] === '-') {
      i += 2;
      push(TokenKind.Arrow, start, i);
      continue;
    }
    if (c === ':' && i + 1 < source.length && source[i + 1] === '=') {
      i += 2;
      push(TokenKind.Arrow, start, i);
      continue;
    }

    // Numbers and dates:  dd/mm/yyyy  dates take priority, then 123 | 4.7
    if (isDigit(c)) {
      const prev = start > 0 ? source[start - 1] : '';
      if (!isWordChar(prev) && matchesDate(source, start)) {
        i += 10;
        push(TokenKind.DateLiteral, start, i);
        continue;
      }
      while (i < source.length && isDigit(source[i])) i += 1;
      if (i + 1 < source.length && source[i] === '.' && isDigit(source[i + 1])) {
        i += 2;
        while (i < source.length && isDigit(source[i])) i += 1;
        push(TokenKind.Real, start, i);
      } else {
        push(TokenKind.Integer, start, i);
      }
      continue;
    }

    // Words (identifiers / keywords) — must start with a letter per section 2.3.
    if (isLetter(c) || c === '_') {
      while (i < source.length && isWordChar(source[i])) i += 1;
      // reject leading underscore (identifiers must start with a letter)
      if (source[start] === '_') {
        tokens.push({ kind: TokenKind.Error, value: 'Identifiers must start with a letter', line, char: start - lineStart, length: i - start, offset: start });
      } else {
        push(TokenKind.Word, start, i);
      }
      continue;
    }

    // Multi-character operators
    if (c === '<') {
      const next = source[i + 1];
      if (next === '>' || next === '=') {
        i += 2;
        push(TokenKind.Operator, start, i);
        continue;
      }
    }
    if (c === '>') {
      const next = source[i + 1];
      if (next === '=') {
        i += 2;
        push(TokenKind.Operator, start, i);
        continue;
      }
    }

    // Single-character operators / punctuation
    if (OPERATORS.has(c)) {
      i += 1;
      push(TokenKind.Operator, start, i);
      continue;
    }

    // Anything else: report and skip so scanning never stalls.
    i += 1;
    tokens.push({ kind: TokenKind.Error, value: `Unexpected character "${c}"`, line, char: start - lineStart, length: 1, offset: start });
  }

  tokens.push(eof());
  return tokens;
}

/** True when source.slice(start, start+10) matches dd/mm/yyyy with clean boundaries. */
function matchesDate(source: string, start: number): boolean {
  if (start + 10 > source.length) return false;
  const s = source.slice(start, start + 10);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
  const after = source[start + 10];
  return !(after !== undefined && isWordChar(after));
}

/** Classified word kind for a Word token (used by providers). */
export function wordKind(token: Token): string {
  return classifyWord(token.value);
}