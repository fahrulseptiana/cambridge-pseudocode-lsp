/**
 * semanticTokens.ts — token coloring. Notes the scanner's kind + the analyzer's
 * symbol resolution so identifiers are colored by their role (variable,
 * constant, type, class member…), with a `declaration` modifier at definitions.
 */

import { SemanticTokens, SemanticTokenTypes } from 'vscode-languageserver-types';
import { DocumentModel } from '../../core/analyzer';
import { Token, TokenKind, wordKind } from '../../core/scanner';
import { declarationPositions } from './context';

export const SEMANTIC_TOKEN_TYPES: string[] = [
  SemanticTokenTypes.namespace,
  SemanticTokenTypes.type,       // 1
  SemanticTokenTypes.class,      // 2
  SemanticTokenTypes.property,   // 3
  SemanticTokenTypes.parameter,  // 4
  SemanticTokenTypes.variable,   // 5
  SemanticTokenTypes.function,   // 6
  SemanticTokenTypes.method,     // 7
  SemanticTokenTypes.keyword,    // 8
  SemanticTokenTypes.modifier,   // 9
  SemanticTokenTypes.comment,    // 10
  SemanticTokenTypes.string,     // 11
  SemanticTokenTypes.number,     // 12
  SemanticTokenTypes.operator,   // 13
  SemanticTokenTypes.enum,       // 14
  SemanticTokenTypes.enumMember, // 15
];

const DECLARATION_MODIFIER = 0b00000001; // bit position for "declaration"

export function provideSemanticTokens(model: DocumentModel): SemanticTokens {
  const declPos = declarationPositions(model);
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of model.tokens) {
    if (token.kind === TokenKind.Newline || token.kind === TokenKind.EndOfFile) continue;
    const t = classifyToken(token, model, declPos);
    if (!t) continue;
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
    data.push(deltaLine, deltaChar, token.length, t.typeIndex, t.modifiers);
    prevLine = token.line;
    prevChar = token.char;
  }

  // Cast preserves the wire shape while keeping the public type correct.
  return { data } as SemanticTokens;
}

function classifyToken(
  token: Token,
  model: DocumentModel,
  declPos: Set<string>
): { typeIndex: number; modifiers: number } | null {
  switch (token.kind) {
    case TokenKind.Newline:
    case TokenKind.EndOfFile:
      return null;
    case TokenKind.Comment:
      return { typeIndex: 10, modifiers: 0 };
    case TokenKind.StringLiteral:
      return { typeIndex: 11, modifiers: 0 };
    case TokenKind.CharLiteral:
      return { typeIndex: 11, modifiers: 0 };
    case TokenKind.Integer:
    case TokenKind.Real:
    case TokenKind.DateLiteral:
      return { typeIndex: 12, modifiers: 0 };
    case TokenKind.Arrow:
      return { typeIndex: 13, modifiers: 0 };
    case TokenKind.Operator: {
      if (['(', ')', '[', ']', ',', ':'].includes(token.value)) return null; // punctuation not colored
      return { typeIndex: 13, modifiers: 0 };
    }
    case TokenKind.Word: {
      const kind = wordKind(token);
      if (kind === 'keyword') return { typeIndex: 8, modifiers: 0 };
      if (kind === 'boolean') return { typeIndex: 8, modifiers: 0 };
      if (kind === 'operator') return { typeIndex: 13, modifiers: 0 };
      if (kind === 'type') return { typeIndex: 1, modifiers: 0 };
      if (kind === 'builtin') return { typeIndex: 6, modifiers: 0 };

      // identifier — resolve to its symbol role.
      const key = `${token.line}:${token.char}`;
      const sym = model.nameResolutions.get(key);
      let typeIndex: number;
      switch (sym?.kind) {
        case 'class': typeIndex = 2; break;
        case 'type': typeIndex = 1; break;
        case 'enum': typeIndex = 15; break;
        case 'parameter': typeIndex = 4; break;
        case 'property': case 'field': typeIndex = 3; break;
        case 'constant': typeIndex = 5; break;
        case 'procedure': typeIndex = 6; break;
        case 'function': typeIndex = 6; break;
        default: typeIndex = 5; // variable / loop / unknown identifier
      }
      const modifiers = declPos.has(key) ? DECLARATION_MODIFIER : 0;
      return { typeIndex, modifiers };
    }
    case TokenKind.Error:
      return { typeIndex: 9, modifiers: 0 }; // modifier token = invalid/error styling
  }
}