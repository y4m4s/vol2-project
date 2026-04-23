import * as vscode from "vscode";

export const ASK_SELECTION_COMMAND = "aiPairNavigator.askSelection";

export class NaviComSelectionCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorRewrite];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] {
    if (document.uri.scheme !== "file" || range.isEmpty) {
      return [];
    }

    const action = new vscode.CodeAction(
      "NaviCom: この箇所を相談",
      vscode.CodeActionKind.RefactorRewrite
    );
    action.command = {
      command: ASK_SELECTION_COMMAND,
      title: "NaviCom: この箇所を相談",
      arguments: [document.uri, range]
    };

    return [action];
  }
}
