import * as vscode from "vscode";
import { NavigatorContextSnapshot } from "../shared/types";

export class ContextCollector {
  public collectPreview(): NavigatorContextSnapshot {
    const editor = vscode.window.activeTextEditor;
    const selectedText = editor?.document.getText(editor.selection).trim();
    const diagnosticsSummary = editor
      ? vscode.languages
          .getDiagnostics(editor.document.uri)
          .slice(0, 5)
          .map((diagnostic) => `${vscode.DiagnosticSeverity[diagnostic.severity]}: ${diagnostic.message}`)
      : [];

    return {
      activeFilePath: editor?.document.uri.fsPath,
      selectedText: selectedText || undefined,
      diagnosticsSummary,
      relatedSymbols: [],
      recentEditsSummary: []
    };
  }
}
