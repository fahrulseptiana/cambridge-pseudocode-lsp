import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentSymbol, Range } from 'vscode-languageserver-types';
import { analyze } from '../src/core/analyzer';
import { provideDocumentSymbols } from '../src/lsp/providers/documentSymbols';

function flatten(symbols: DocumentSymbol[]): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  for (const s of symbols) {
    out.push(s);
    if (s.children) out.push(...flatten(s.children));
  }
  return out;
}

/** LSP invariant: selectionRange must be contained in range (client validates this). */
function contains(range: Range, selection: Range): boolean {
  const startsAfter = selection.start.line > range.start.line ||
    (selection.start.line === range.start.line && selection.start.character >= range.start.character);
  const endsBefore = selection.end.line < range.end.line ||
    (selection.end.line === range.end.line && selection.end.character <= range.end.character);
  return startsAfter && endsBefore;
}

test('document symbols: selectionRange is always contained in range', () => {
  const src = [
    'TYPE Season = (Spring, Summer, Autumn, Winter)', // enum values: zero-width declRange
    'DECLARE Counter : INTEGER',
    'Undeclared ← 1', // implicit variable: point declRange
    'PROCEDURE Greet(Name : STRING)',
    '  OUTPUT Name',
    'ENDPROCEDURE',
    'FUNCTION Max(A : INTEGER, B : INTEGER) RETURNS INTEGER',
    '  RETURN A',
    'ENDFUNCTION',
  ].join('\n');
  const model = analyze('test://doc.pseudo', src);
  const symbols = flatten(provideDocumentSymbols(model));
  assert.ok(symbols.length >= 6, `expected outline entries, got ${symbols.length}`);
  for (const s of symbols) {
    assert.ok(contains(s.range, s.selectionRange), `selectionRange not contained in range for '${s.name}'`);
  }
});

test('document symbols: enum values are children of their TYPE, not separate roots', () => {
  const model = analyze('test://doc.pseudo', 'TYPE Colour = (Red, Green, Blue)\nDECLARE C : Colour\n');
  const top = provideDocumentSymbols(model);
  const colour = top.find((s) => s.name === 'Colour');
  assert.ok(colour, 'Colour should appear in the outline');
  assert.deepEqual(colour.children?.map((c) => c.name), ['Red', 'Green', 'Blue']);
  assert.ok(!top.some((s) => s.name === 'Red' || s.name === 'Green' || s.name === 'Blue'));
});