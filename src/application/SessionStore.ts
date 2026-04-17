import * as vscode from "vscode";
import { NavigatorSessionState } from "../shared/types";

export class SessionStore implements vscode.Disposable {
  private state: NavigatorSessionState;
  private readonly didChangeStateEmitter = new vscode.EventEmitter<NavigatorSessionState>();

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(initialState: NavigatorSessionState) {
    this.state = initialState;
  }

  public getState(): NavigatorSessionState {
    return this.state;
  }

  public patch(partial: Partial<NavigatorSessionState>): void {
    this.state = {
      ...this.state,
      ...partial
    };

    this.didChangeStateEmitter.fire(this.state);
  }

  public resetStatusMessage(): void {
    if (!this.state.statusMessage) {
      return;
    }

    this.patch({ statusMessage: undefined });
  }

  public dispose(): void {
    this.didChangeStateEmitter.dispose();
  }
}
