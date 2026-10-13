/**
 * diagnostics.ts — publishes `core` model issues as LSP diagnostics.
 * Pure mapping: severity translation + range conversion, nothing else.
 */

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-types';
import { IssueSeverity, DocumentModel } from '../../core/analyzer';
import { toRange } from '../convert';

const SEVERITY: Record<IssueSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  hint: DiagnosticSeverity.Hint,
};

export function provideDiagnostics(model: DocumentModel): Diagnostic[] {
  return model.issues.map((issue) => ({
    range: toRange(issue.range),
    message: issue.message,
    severity: SEVERITY[issue.severity],
    source: 'pseudocode',
  }));
}