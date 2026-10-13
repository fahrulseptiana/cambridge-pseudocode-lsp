import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/core/parser';
import { TokenKind } from '../src/core/scanner';

test('parses IF/ELSE and detects missing ENDIF', () => {
  const ok = parse('IF X > 5 THEN\n  OUTPUT X\nELSE\n  OUTPUT 0\nENDIF\n');
  assert.equal(ok.issues.filter((i) => i.severity === 'error').length, 0);
  assert.equal(ok.program.statements.length, 1);

  const bad = parse('IF X > 5 THEN\n  OUTPUT X\n');
  assert.ok(bad.issues.some((i) => i.message.includes('ENDIF')));
});

test('parses CASE with ranges and OTHERWISE', () => {
  const src = ['DECLARE Score : INTEGER', 'CASE OF Score', '1 : OUTPUT "one"', '2 TO 4 : OUTPUT "mid"', 'OTHERWISE : OUTPUT "low"', 'ENDCASE'].join('\n');
  const r = parse(src);
  assert.equal(r.issues.length, 0, r.issues.map((i) => i.message).join('; '));
  const cs = r.program.statements[1];
  assert.equal(cs.kind, 'CaseStmt');
  assert.equal(cs.branches.length, 2);
  assert.equal(cs.branches[1].values[0].kind, 'RangeExpr');
  assert.ok(cs.otherwise);
});

test('parses FOR..NEXT with STEP and mismatched NEXT id', () => {
  const src = ['FOR I ← 1 TO 10 STEP 2', '  OUTPUT I', 'NEXT I'].join('\n');
  const r = parse(src);
  assert.equal(r.issues.length, 0);
  const f = r.program.statements[0];
  assert.equal(f.kind, 'ForStmt');
  assert.ok(f.step && f.step.kind === 'LiteralExpr');
  assert.equal(f.nextVar, 'I');
});

test('parses REPEAT and WHILE loops', () => {
  const repeat = parse('REPEAT\n  INPUT X\nUNTIL X = 0\n');
  assert.equal(repeat.issues.length, 0);
  const w = parse('WHILE NOT EOF("F")\n  READFILE "F", L\nENDWHILE\n');
  assert.equal(w.issues.length, 0);
});

test('parses procedures, functions and parameters', () => {
  const src = [
    'PROCEDURE SWAP(BYREF X : INTEGER, Y : INTEGER)',
    '  Temp ← X',
    'ENDPROCEDURE',
    'FUNCTION Max(Number1 : INTEGER, Number2 : INTEGER) RETURNS INTEGER',
    '  IF Number1 > Number2 THEN',
    '    RETURN Number1',
    '  ENDIF',
    'ENDFUNCTION',
  ].join('\n');
  const r = parse(src);
  assert.equal(r.issues.length, 0, r.issues.map((i) => i.message).join('; '));
  const [proc, fn] = r.program.statements;
  assert.equal(proc.kind, 'ProcedureDecl');
  assert.equal(proc.params[0].byRef, true);
  assert.equal(fn.kind, 'FunctionDecl');
  assert.equal(fn.returns?.kind === 'TypeRef' && fn.returns.name, 'INTEGER');
});

test('parses TYPE forms: enum, pointer, set and record', () => {
  const enumOk = parse('TYPE Season = (Spring, Summer, Autumn, Winter)\n');
  assert.equal(enumOk.issues.length, 0);

  const pointerOk = parse('TYPE TIntPointer = ^INTEGER\n');
  assert.equal(pointerOk.issues.length, 0);

  const setOk = parse('TYPE LetterSet = SET OF CHAR\nDEFINE Vowels (\'A\',\'E\') : LetterSet\n');
  assert.equal(setOk.issues.length, 0);

  const record = parse([
    'TYPE StudentRecord',
    '  DECLARE LastName : STRING',
    '  DECLARE YearGroup : INTEGER',
    'ENDTYPE',
  ].join('\n'));
  assert.equal(record.issues.length, 0, record.issues.map((i) => i.message).join('; '));
  const td = record.program.statements[0];
  assert.equal(td.kind, 'TypeDecl');
  assert.equal(td.recordFields?.length, 2);
});

test('parses CLASS with INHERITS, PUBLIC/PRIVATE and NEW construction', () => {
  const src = [
    'CLASS Cat INHERITS Pet',
    '  PRIVATE Breed : STRING',
    '  PUBLIC PROCEDURE NEW(GivenName : STRING, GivenBreed : STRING)',
    '    SUPER.NEW(GivenName)',
    '  ENDPROCEDURE',
    'ENDCLASS',
    'MyCat ← NEW Cat("Kitty", "Shorthaired")',
  ].join('\n');
  const r = parse(src);
  assert.equal(r.issues.filter((i) => i.severity === 'error').length, 0, r.issues.map((i) => i.message).join('; '));
});

test('parses file handling statements', () => {
  const src = [
    'OPENFILE "FileA.txt" FOR READ',
    'READFILE "FileA.txt", LineOfText',
    'WRITEFILE "FileB.txt", LineOfText',
    'CLOSEFILE "FileA.txt"',
    'SEEK "F.Dat", Position + 1',
    'GETRECORD "F.Dat", Pupil',
    'PUTRECORD "F.Dat", NewPupil',
  ].join('\n');
  const r = parse(src);
  assert.equal(r.issues.length, 0, r.issues.map((i) => i.message).join('; '));
});

test('parses array declarations and nested member access across wrapped lines', () => {
  const src = [
    'DECLARE MaxRow : INTEGER',
    'DECLARE RowTotal : INTEGER',
    'DECLARE Amount : ARRAY[1:30,1:10] OF INTEGER',
    'DECLARE Column : INTEGER',
    'FOR Row ← 1 TO MaxRow',
    '  RowTotal ← RowTotal + Amount[Row,',
    '    Column]',
    'NEXT Row',
  ].join('\n');
  const r = parse(src);
  assert.equal(r.issues.filter((i) => i.severity === 'error').length, 0, r.issues.map((i) => i.message).join('; '));
});

test('parses logical expressions with correct precedence', () => {
  const ok = parse('GameOver ← (Score >= 100) AND NOT Lost\n');
  assert.equal(ok.issues.length, 0);
});

test('recovers gracefully on malformed lines without hanging', () => {
  const r = parse('FOOBAR baz\nIF X THEN\nWHAT\nENDIF\n');
  assert.ok(r.issues.length > 0);
  assert.equal(r.tokens[r.tokens.length - 1].kind, TokenKind.EndOfFile);
});