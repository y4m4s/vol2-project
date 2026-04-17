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

export class ContextCollector {
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
        diagnosticsSummary: []
      };
    }

    const selectedText = this.getSelectedText(editor);

    return {
      activeFilePath: editor.document.uri.fsPath,
      activeFileLanguage: editor.document.languageId,
      activeFileExcerpt: this.collectActiveFileExcerpt(editor, selectedText),
      selectedText: this.limitText(selectedText, MAX_SELECTED_TEXT_LENGTH),
      diagnosticsSummary: this.collectDiagnostics(editor.document.uri)
    };
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
}
