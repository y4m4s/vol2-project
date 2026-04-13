import { ConnectionState } from "../shared/types";

export class CopilotService {
  private connectionState: ConnectionState = "disconnected";

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public async connect(): Promise<ConnectionState> {
    this.connectionState = "connecting";

    // TODO: Replace with VS Code Language Model API integration.
    this.connectionState = "connected";
    return this.connectionState;
  }

  public async requestGuidance(): Promise<string> {
    // TODO: Replace with real Copilot prompt execution.
    return "Copilot service is not connected yet. This is a placeholder guidance response.";
  }
}
