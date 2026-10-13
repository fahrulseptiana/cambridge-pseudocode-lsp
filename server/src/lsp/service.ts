/**
 * service.ts — the LanguageService: the narrow seam (interface) between the
 * pure language layer (core/) and the LSP providers (DIP).
 *
 * Providers depend only on this interface, so they can be tested without a
 * running server and the storage strategy can change without touching them.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, DocumentModel } from '../core/analyzer';

export interface LanguageService {
  /** Cached (or computed) model for a document URI. */
  getModel(uri: string): DocumentModel | undefined;
  /** Parse + analyse a text document and remember the result. */
  analyzeAndCache(doc: TextDocument): DocumentModel;
  /** Forget a document (on close). */
  drop(uri: string): void;
}

/** Default in-memory implementation holding every analysed document. */
export class MemoryDocumentService implements LanguageService {
  private readonly models = new Map<string, DocumentModel>();

  getModel(uri: string): DocumentModel | undefined {
    return this.models.get(uri);
  }

  analyzeAndCache(doc: TextDocument): DocumentModel {
    const model = analyze(doc.uri, doc.getText());
    this.models.set(doc.uri, model);
    return model;
  }

  drop(uri: string): void {
    this.models.delete(uri);
  }
}