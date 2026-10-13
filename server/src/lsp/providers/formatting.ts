/**
 * formatting.ts — document formatting: re-indentation from the core formatter.
 * Returns minimal edits that change only leading whitespace.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit } from 'vscode-languageserver-types';
import { computeIndents } from '../../core/formatter';

export function provideFormatting(doc: TextDocument): TextEdit[] {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const edits: TextEdit[] = [];

  for (const e of computeIndents(text)) {
    const original = lines[e.line] ?? '';
    if (original.trimStart() === '' && original.trim() === '') continue; // blank line: leave alone
    const indentLen = original.length - original.trimStart().length;
    const newIndent = e.indent;
    if (newIndent.length === indentLen) continue;
    edits.push({
      range: {
        start: { line: e.line, character: 0 },
        end: { line: e.line, character: indentLen },
      },
      newText: newIndent,
    });
  }
  return edits;
}