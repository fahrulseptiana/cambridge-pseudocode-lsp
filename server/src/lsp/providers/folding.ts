/**
 * folding.ts — folding ranges for block constructs (IF…ENDIF, loops,
 * PROCEDURE/FUNCTION/CLASS, records) plus contiguous comment blocks.
 */

import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver-types';
import { Declaration, Statement } from '../../core/ast';
import { DocumentModel } from '../../core/analyzer';
import { Token, TokenKind } from '../../core/scanner';

interface BlockRange { startLine: number; endLine: number; }

export function provideFoldingRanges(model: DocumentModel): FoldingRange[] {
  const ranges: BlockRange[] = [];
  collectBlocks(model.program.statements, ranges);

  const result: FoldingRange[] = ranges
    .filter((r) => r.endLine - r.startLine >= 1)
    .map((r) => ({ startLine: r.startLine + 1, endLine: r.endLine - 1, kind: FoldingRangeKind.Region }));

  result.push(...commentBlocks(model.tokens));
  return result;
}

function collectBlocks(statements: ReadonlyArray<Statement | Declaration>, out: BlockRange[]): void {
  for (const st of statements) {
    switch (st.kind) {
      case 'IfStmt':
        out.push({ startLine: st.start.line, endLine: st.end.line });
        collectBlocks(st.thenBody, out);
        if (st.elseBody) collectBlocks(st.elseBody, out);
        break;
      case 'CaseStmt':
        out.push({ startLine: st.start.line, endLine: st.end.line });
        for (const b of st.branches) collectBlocks(b.body, out);
        if (st.otherwise) collectBlocks(st.otherwise, out);
        break;
      case 'ForStmt':
      case 'WhileStmt':
      case 'RepeatStmt':
        out.push({ startLine: st.start.line, endLine: st.end.line });
        collectBlocks(st.body, out);
        break;
      case 'ProcedureDecl':
      case 'FunctionDecl':
        out.push({ startLine: st.start.line, endLine: st.end.line });
        collectBlocks(st.body, out);
        break;
      case 'ClassDecl':
        out.push({ startLine: st.start.line, endLine: st.end.line });
        for (const m of st.members) {
          if (m.kind === 'ProcedureDecl' || m.kind === 'FunctionDecl') collectBlocks([m], out);
        }
        break;
      case 'TypeDecl':
        if (st.form === 'record') out.push({ startLine: st.start.line, endLine: st.end.line });
        break;
    }
  }
}

function commentBlocks(tokens: Token[]): FoldingRange[] {
  const result: FoldingRange[] = [];
  let runStart = -1;
  let last = -1;
  for (const t of tokens) {
    if (t.kind === TokenKind.Comment) {
      if (runStart < 0) {
        runStart = t.line;
        last = t.line;
      } else if (t.line === last + 1) {
        last = t.line;
      }
    } else if (t.kind === TokenKind.Newline || t.kind === TokenKind.EndOfFile) {
      if (runStart >= 0 && last > runStart) {
        result.push({ startLine: runStart, endLine: last, kind: FoldingRangeKind.Comment });
      }
      runStart = -1;
    }
  }
  return result;
}