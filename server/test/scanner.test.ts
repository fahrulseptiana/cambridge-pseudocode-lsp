import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenKind, scan } from '../src/core/scanner';

test('scans keywords, identifiers and numbers', () => {
  const tokens = scan('DECLARE Counter : INTEGER\r\nCounter <- 3');
  const kinds = tokens.map((t) => TokenKind[t.kind]);
  assert.deepEqual(kinds, ['Word', 'Word', 'Operator', 'Word', 'Newline', 'Word', 'Arrow', 'Integer', 'EndOfFile']);
  assert.equal(tokens[0].value, 'DECLARE');
  assert.equal(tokens[1].value, 'Counter');
  assert.equal(tokens[7].value, '3');
});

test('recognises the three supported assignment operators', () => {
  for (const arrow of ['←', '<-', ':=']) {
    const tokens = scan(`X ${arrow} 1`);
    assert.equal(tokens[1].kind, TokenKind.Arrow, `expected '${arrow}' to lex as Arrow`);
  }
});

test('recognises date literals (dd/mm/yyyy) without breaking division', () => {
  const withDate = scan('Pupil1.DateOfBirth ← 02/01/2005');
  assert.ok(withDate.some((t) => t.kind === TokenKind.DateLiteral));
  const division = scan('X ← 12 / 4');
  assert.equal(division[2].kind, TokenKind.Integer);
  assert.equal(division[3].value, '/');
});

test('scans strings, chars and comments', () => {
  const tokens = scan('OUTPUT "Hello ", \'A\' // trailing');
  assert.ok(tokens.some((t) => t.kind === TokenKind.StringLiteral));
  assert.ok(tokens.some((t) => t.kind === TokenKind.CharLiteral));
  const comment = tokens.find((t) => t.kind === TokenKind.Comment);
  assert.ok(comment && comment.value === '// trailing');
});

test('reports unterminated strings as Error tokens (never stalls)', () => {
  const tokens = scan('OUTPUT "oops');
  assert.ok(tokens.some((t) => t.kind === TokenKind.Error));
  assert.equal(tokens[tokens.length - 1].kind, TokenKind.EndOfFile);
});

test('rejects invalid identifiers starting with an underscore', () => {
  const tokens = scan('_bad');
  assert.equal(tokens[0].kind, TokenKind.Error);
});

test('tracks positions', () => {
  const tokens = scan('A\nB');
  assert.deepEqual(
    [tokens[0].line, tokens[0].char, tokens[2].line, tokens[2].char],
    [0, 0, 1, 0]
  );
});