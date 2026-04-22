import * as vscode from "vscode";
import {
  DiagnosticSeverityLabel,
  DiagnosticSummary,
  GuidanceContext,
  NavigatorContextPreview
} from "../shared/types";

const MAX_PREVIEW_TEXT_LENGTH = 240;
const MAX_SELECTED_TEXT_LENGTH = 4000;
const MAX_ACTIVE_FILE_EXCERPT_LENGTH = 8000;
const MAX_DIAGNOSTIC_COUNT = 5;
const FALLBACK_TOP_LINE_COUNT = 80;
const MAX_RECENT_EDIT_COUNT = 5;
const MAX_RECENT_EDIT_PREVIEW_LENGTH = 100;
const RECENT_EDIT_TTL_MS = 5 * 60 * 1000;

interface RecentEditRecord {
  lineStart: number;
  lineEnd: number;
  preview: string;
  timestamp: number;
}

export class ContextCollector {
  private readonly recentEditsByDocument = new Map<string, RecentEditRecord[]>();
  private readonly documentSnapshotsByUri = new Map<string, string>();

  public primeDocuments(documents: readonly vscode.TextDocument[]): void {
    for (const document of documents) {
      this.primeDocument(document);
    }
  }

  public primeDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file") {
      return;
    }

    this.documentSnapshotsByUri.set(document.uri.toString(), document.getText());
  }

  public releaseDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.documentSnapshotsByUri.delete(key);
    this.recentEditsByDocument.delete(key);
  }

  public collectPreview(): NavigatorContextPreview {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return {
        diagnosticsSummary: []
      };
    }

    const selectedText = this.getSelectedText(editor);

    return {
      activeFilePath: editor.document.uri.fsPath,
      selectedTextPreview: this.toPreviewText(selectedText),
      diagnosticsSummary: this.collectDiagnostics(editor.document.uri)
    };
  }

  public collectGuidanceContext(): GuidanceContext {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return {
        diagnosticsSummary: [],
        recentEditsSummary: [],
        relatedSymbols: []
      };
    }

    const selectedText = this.getSelectedText(editor);

    return {
      activeFilePath: editor.document.uri.fsPath,
      activeFileLanguage: editor.document.languageId,
      activeFileExcerpt: this.collectActiveFileExcerpt(editor, selectedText),
      selectedText: this.limitText(selectedText, MAX_SELECTED_TEXT_LENGTH),
      diagnosticsSummary: this.collectDiagnostics(editor.document.uri),
      recentEditsSummary: this.collectRecentEdits(editor.document.uri),
      relatedSymbols: this.collectRelatedSymbols(editor, selectedText)
    };
  }

  public captureDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0 || event.document.uri.scheme !== "file") {
      return;
    }

    const key = event.document.uri.toString();
    const previousText = this.documentSnapshotsByUri.get(key);
    const existing = this.pruneRecentEdits(this.recentEditsByDocument.get(key) ?? []);
    const changes = event.contentChanges
      .slice(0, MAX_RECENT_EDIT_COUNT)
      .map((change) => this.toRecentEditRecord(change, previousText));
    const nextRecords = [...changes, ...existing].slice(0, MAX_RECENT_EDIT_COUNT);

    this.recentEditsByDocument.set(key, nextRecords);
    this.documentSnapshotsByUri.set(key, event.document.getText());
  }

  private getSelectedText(editor: vscode.TextEditor): string | undefined {
    if (editor.selection.isEmpty) {
      return undefined;
    }

    const text = editor.document.getText(editor.selection);
    return text.trim().length > 0 ? text : undefined;
  }

  private collectDiagnostics(uri: vscode.Uri): DiagnosticSummary[] {
    return vscode.languages.getDiagnostics(uri).slice(0, MAX_DIAGNOSTIC_COUNT).map((diagnostic) => ({
      severity: this.mapSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      line: diagnostic.range.start.line + 1
    }));
  }

  private collectActiveFileExcerpt(editor: vscode.TextEditor, selectedText?: string): string | undefined {
    if (selectedText) {
      return this.limitText(selectedText, MAX_ACTIVE_FILE_EXCERPT_LENGTH);
    }

    const visibleRange = editor.visibleRanges[0];
    if (visibleRange) {
      const visibleText = editor.document.getText(visibleRange);
      if (visibleText.trim().length > 0) {
        return this.limitText(visibleText, MAX_ACTIVE_FILE_EXCERPT_LENGTH);
      }
    }

    const lastLine = Math.min(editor.document.lineCount - 1, FALLBACK_TOP_LINE_COUNT - 1);
    if (lastLine < 0) {
      return undefined;
    }

    const fallbackRange = new vscode.Range(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
    const fallbackText = editor.document.getText(fallbackRange);

    return fallbackText.trim().length > 0
      ? this.limitText(fallbackText, MAX_ACTIVE_FILE_EXCERPT_LENGTH)
      : undefined;
  }

  private toPreviewText(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    return this.limitText(normalized, MAX_PREVIEW_TEXT_LENGTH);
  }

  private limitText(value: string | undefined, maxLength: number): string | undefined {
    if (!value) {
      return undefined;
    }

    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticSeverityLabel {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return "Error";
      case vscode.DiagnosticSeverity.Warning:
        return "Warning";
      case vscode.DiagnosticSeverity.Information:
        return "Information";
      case vscode.DiagnosticSeverity.Hint:
      default:
        return "Hint";
    }
  }

  private collectRecentEdits(uri: vscode.Uri): string[] {
    const key = uri.toString();
    const records = this.pruneRecentEdits(this.recentEditsByDocument.get(key) ?? []);

    if (records.length === 0) {
      return [];
    }

    this.recentEditsByDocument.set(key, records);

    return records.map((record) => {
      const lineLabel = record.lineStart === record.lineEnd ? `L${record.lineStart}` : `L${record.lineStart}-L${record.lineEnd}`;
      return `${lineLabel}: ${record.preview}`;
    });
  }

  private collectRelatedSymbols(editor: vscode.TextEditor, selectedText?: string): string[] {
    const candidates = new Set<string>();

    const selectedToken = this.extractSingleToken(selectedText);
    if (selectedToken) {
      candidates.add(selectedToken);
    }

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (wordRange) {
      const word = editor.document.getText(wordRange).trim();
      if (this.isSymbolCandidate(word)) {
        candidates.add(word);
      }
    }

    const lineText = editor.document.lineAt(editor.selection.active.line).text;
    for (const match of lineText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
      const candidate = match[0];
      if (this.isSymbolCandidate(candidate)) {
        candidates.add(candidate);
      }
      if (candidates.size >= 5) {
        break;
      }
    }

    return [...candidates].slice(0, 5);
  }

  private pruneRecentEdits(records: RecentEditRecord[]): RecentEditRecord[] {
    const threshold = Date.now() - RECENT_EDIT_TTL_MS;
    return records.filter((record) => record.timestamp >= threshold);
  }

  private toRecentEditRecord(change: vscode.TextDocumentContentChangeEvent, previousText?: string): RecentEditRecord {
    const beforeText =
      typeof previousText === "string"
        ? previousText.slice(change.rangeOffset, change.rangeOffset + change.rangeLength)
        : undefined;

    return {
      lineStart: change.range.start.line + 1,
      lineEnd: Math.max(change.range.end.line + 1, change.range.start.line + 1),
      preview: this.toRecentEditPreview(beforeText, change.text),
      timestamp: Date.now()
    };
  }

  private toRecentEditPreview(beforeValue: string | undefined, afterValue: string): string {
    const beforePreview = this.toRecentEditFragment(beforeValue);
    const afterPreview = this.toRecentEditFragment(afterValue);

    if (beforePreview && afterPreview) {
      return `変更前「${beforePreview}」 -> 変更後「${afterPreview}」`;
    }

    if (beforePreview) {
      return `削除「${beforePreview}」`;
    }

    if (afterPreview) {
      return `追加「${afterPreview}」`;
    }

    return "変更前スナップショットなし";
  }

  private toRecentEditFragment(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      return undefined;
    }

    return normalized.length <= MAX_RECENT_EDIT_PREVIEW_LENGTH
      ? normalized
      : `${normalized.slice(0, MAX_RECENT_EDIT_PREVIEW_LENGTH)}...`;
  }

  private extractSingleToken(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!this.isSymbolCandidate(trimmed)) {
      return undefined;
    }

    return trimmed;
  }

  private isSymbolCandidate(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]{1,63}$/.test(value);
  }
}
