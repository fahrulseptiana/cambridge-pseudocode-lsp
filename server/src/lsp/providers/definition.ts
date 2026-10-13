/**
 * definition.ts — go-to-definition for identifiers, call sites, member names
 * and enum values. Resolution data comes from the analyzer (nameResolutions),
 * so this provider is a thin lookup + range conversion.
 */

import { Location, Position } from 'vscode-languageserver-types';
import { DocumentModel } from '../../core/analyzer';
import { Token, TokenKind } from '../../core/scanner';
import { toRange } from '../convert';
import { tokenAtPosition } from './context';

export function provideDefinition(model: DocumentModel, uri: string, pos: Position): Location | Location[] | null {
  const token = tokenAtPosition(model, pos);
  if (!token || token.kind !== TokenKind.Word) return null;

  const symbol = model.nameResolutions.get(`${token.line}:${token.char}`);
  if (!symbol) return null;

  return { uri, range: toRange(symbol.declRange) };
}

/** Public for tests: token lookup stays reusable. */
export function tokenAtPositionForTest(model: DocumentModel, pos: Position): Token | null {
  return tokenAtPosition(model, pos);
}