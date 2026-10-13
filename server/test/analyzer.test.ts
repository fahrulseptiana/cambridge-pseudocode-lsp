import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, SymbolInfo } from '../src/core/analyzer';

function messages(src: string): string[] {
  return analyze('test://a.pseudo', src).issues.map((i) => `${i.severity}: ${i.message}`);
}
function errors(src: string): string[] {
  return messages(src).filter((m) => m.startsWith('error'));
}

test('flags unknown identifiers and undeclared procedures/functions', () => {
  assert.ok(errors('Counter ← 1 + Missing\n').some((m) => m.includes("Unknown identifier 'Missing'")));
  assert.ok(errors('CALL DoSomething()\n').some((m) => m.includes("Unknown procedure 'DoSomething'")));
  assert.ok(errors('X ← Max(10, 20)\n').some((m) => m.includes("Unknown function 'Max'")));
});

test('flags duplicate declarations and constant assignment', () => {
  assert.ok(errors('DECLARE X : INTEGER\nDECLARE X : REAL\n').some((m) => m.includes('Duplicate declaration')));
  assert.ok(errors('CONSTANT MAX = 10\nMAX ← 5\n').some((m) => m.includes('Cannot assign a value to the constant')));
});

test('constant value must be a literal', () => {
  assert.ok(errors('CONSTANT BAD = MAX + 1\n').some((m) => m.includes('Only a literal')));
});

test('flags type mismatches but allows widening', () => {
  assert.ok(errors('DECLARE X : INTEGER\nX ← 3.5\n').some((m) => m.includes('Type mismatch')));
  assert.ok(errors('DECLARE X : BOOLEAN\nX ← "yes"\n').some((m) => m.includes('Type mismatch')));
  assert.ok(!errors('DECLARE X : REAL\nX ← 3\n').some((m) => m.includes('Type mismatch')));
  assert.ok(!errors('DECLARE X : STRING\nX ← \'A\'\n').some((m) => m.includes('Type mismatch')));
});

test('checks conditions are BOOLEAN', () => {
  assert.ok(errors('DECLARE X : INTEGER\nIF X THEN\n  OUTPUT 1\nENDIF\n').some((m) => m.includes('BOOLEAN')));
  assert.ok(!errors('DECLARE X : BOOLEAN\nIF X THEN\n  OUTPUT 1\nENDIF\n').some((m) => m.includes('BOOLEAN')));
});

test('reports NEXT mismatch and CALL misuse', () => {
  assert.ok(errors('FOR I ← 1 TO 5\nNEXT J\n').some((m) => m.includes('does not match the loop variable')));
  const warning = messages('PROCEDURE P()\n  RETURN 5\nENDPROCEDURE\n').some((m) => m.startsWith('warning') && m.includes('RETURN'));
  assert.ok(warning);
});

test('checks builtin arity and argument types', () => {
  const ok = 'DECLARE X : STRING\n';
  assert.equal(errors(ok + 'X ← RIGHT("ABCDEF", 2)\n').length, 0);
  assert.ok(errors(ok + 'X ← LENGTH("abc", 2)\n').some((m) => m.includes("expects 1 argument(s)")));
  assert.ok(errors(ok + 'X ← RIGHT(42, 2)\n').some((m) => m.includes('STRING')));
});

test('checks user procedure arity', () => {
  const src = 'PROCEDURE P(A : INTEGER, B : INTEGER)\nENDPROCEDURE\nCALL P(1)\n';
  assert.ok(errors(src).some((m) => m.includes('expects 2 argument(s)')));
});

test('resolves procedure scope (params visible, globals visible)', () => {
  const src = [
    'DECLARE Total : INTEGER',
    'PROCEDURE Add(X : INTEGER)',
    '  Total ← Total + X',
    'ENDPROCEDURE',
    'CALL Add(Total)',
  ].join('\n');
  assert.equal(errors(src).length, 0, messages(src).join('; '));
});

test('resolves record members, arrays and enum values', () => {
  const src = [
    'TYPE StudentRecord',
    '  DECLARE LastName : STRING',
    '  DECLARE Age : INTEGER',
    'ENDTYPE',
    'TYPE Season = (Spring, Summer)',
    'DECLARE Form : ARRAY[1:30] OF StudentRecord',
    'DECLARE S : Season',
    'Form[1].LastName ← "Ali"',
    'S ← Spring',
    'OUTPUT Form[1].Age',
  ].join('\n');
  assert.equal(errors(src).length, 0, messages(src).join('; '));
  // unknown member is caught
  assert.ok(errors(src + '\nForm[1].Unknown ← 1\n').some((m) => m.includes('has no member')));
});

test('OOP: methods, properties, NEW and SUPER resolve', () => {
  const src = [
    'CLASS Pet',
    '  PRIVATE Name : STRING',
    '  PUBLIC FUNCTION GetName() RETURNS STRING',
    '    RETURN Name',
    '  ENDFUNCTION',
    'ENDCLASS',
    'CLASS Cat INHERITS Pet',
    '  PUBLIC PROCEDURE NEW(GivenName : STRING)',
    '    SUPER.NEW(GivenName)',
    '  ENDPROCEDURE',
    'ENDCLASS',
    'DECLARE MyCat : Cat',
    'MyCat ← NEW Cat("Kitty")',
    'OUTPUT MyCat.GetName()',
  ].join('\n');
  assert.equal(errors(src).length, 0, messages(src).join('; '));
});

test('named symbols resolve for goto-definition', () => {
  const src = 'DECLARE Counter : INTEGER\nCounter ← Counter + 1\n';
  const model = analyze('test://a.pseudo', src);
  const counter = model.nameResolutions.get('1:10'); // usage position
  assert.ok(counter, 'usage of Counter should resolve');
  assert.equal(counter.kind, 'variable');
  assert.deepEqual(counter.namePos, { line: 0, char: 8 });
});

test('pointer deref and FILE modes parse+analyse', () => {
  const src = [
    'TYPE TIntPointer = ^INTEGER',
    'DECLARE P : TIntPointer',
    'DECLARE N : INTEGER',
    'N ← P^',
    'OPENFILE "A.txt" FOR APPEND',
  ].join('\n');
  assert.equal(errors(src).length, 0, messages(src).join('; '));
});

test('identifiers are case-insensitive (guide §2.3)', () => {
  const src = 'DECLARE Countdown : INTEGER\nCountDown ← 1\nOUTPUT COUNTDOWN\n';
  assert.equal(errors(src).length, 0, messages(src).join('; '));
});

test('string literal type inference', () => {
  const model = analyze('test://a.pseudo', 'DECLARE Name : STRING\nName ← "Sam" & " " & "Lee"\n');
  const desc = model.allSymbols.filter((s): s is SymbolInfo & { name: string } => s.name === 'Name')[0];
  assert.equal(desc?.typeText, 'STRING');
});