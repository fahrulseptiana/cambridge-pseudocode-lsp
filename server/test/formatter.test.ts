import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatText } from '../src/core/formatter';

test('indents IF/ELSE bodies by three spaces', () => {
  const input = ['IF X THEN', 'OUTPUT X', 'ELSE', 'OUTPUT 0', 'ENDIF'].join('\n');
  const out = formatText(input).split('\n');
  assert.equal(out[0], 'IF X THEN');
  assert.equal(out[1], '   OUTPUT X');
  assert.equal(out[2], 'ELSE');
  assert.equal(out[3], '   OUTPUT 0');
  assert.equal(out[4], 'ENDIF');
});

test('handles nested blocks and NEXT/ENDWHILE dedenting', () => {
  const input = [
    'FOR I ← 1 TO 5',
    'FOR J ← 1 TO I',
    'OUTPUT I * J',
    'NEXT J',
    'NEXT I',
    'WHILE X > 0',
    'X ← X - 1',
    'ENDWHILE',
  ].join('\n');
  const out = formatText(input).split('\n');
  assert.equal(out[0], 'FOR I ← 1 TO 5');
  assert.equal(out[1], '   FOR J ← 1 TO I');
  assert.equal(out[2], '      OUTPUT I * J');
  assert.equal(out[3], '   NEXT J');
  assert.equal(out[5], 'WHILE X > 0');
  assert.equal(out[6], '   X ← X - 1');
  assert.equal(out[7], 'ENDWHILE');
});

test('REPEAT/UNTIL indentation', () => {
  const out = formatText('REPEAT\nINPUT P\nUNTIL P = "go"').split('\n');
  assert.equal(out[1], '   INPUT P');
  assert.equal(out[2], 'UNTIL P = "go"');
});

test('single-line TYPE declarations do not open a block', () => {
  const out = formatText(['TYPE Season = (Spring, Summer)', 'DECLARE S : Season', 'IF S THEN', 'OUTPUT 1', 'ENDIF'].join('\n')).split('\n');
  assert.equal(out[1], 'DECLARE S : Season');
  assert.equal(out[3], '   OUTPUT 1');
});

test('record TYPE opens a block until ENDTYPE', () => {
  const out = formatText(['TYPE StudentRecord', 'DECLARE LastName : STRING', 'DECLARE Age : INTEGER', 'ENDTYPE', 'OUTPUT "done"'].join('\n')).split('\n');
  assert.equal(out[1], '   DECLARE LastName : STRING');
  assert.equal(out[3], 'ENDTYPE');
  assert.equal(out[4], 'OUTPUT "done"');
});

test('PROCEDURE/FUNCTION/CLASS bodies are indented', () => {
  const out = formatText([
    'PROCEDURE P()',
    'OUTPUT 1',
    'ENDPROCEDURE',
    'FUNCTION F() RETURNS INTEGER',
    'RETURN 1',
    'ENDFUNCTION',
    'CLASS C',
    'PRIVATE X : INTEGER',
    'ENDCLASS',
  ].join('\n')).split('\n');
  assert.equal(out[1], '   OUTPUT 1');
  assert.equal(out[4], '   RETURN 1');
  assert.equal(out[7], '   PRIVATE X : INTEGER');
});

test('CASE bodies are indented uniformly and comments align', () => {
  const out = formatText(['CASE OF Move', '// pick', 'W : OUTPUT 1', 'OTHERWISE : OUTPUT 0', 'ENDCASE'].join('\n')).split('\n');
  assert.equal(out[2], '   W : OUTPUT 1');
  assert.equal(out[1], '   // pick');
});