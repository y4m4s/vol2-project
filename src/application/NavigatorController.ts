import { ContextCollector } from "../services/ContextCollector";
import { CopilotService } from "../services/CopilotService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import { NavigatorViewState } from "../shared/types";

export class NavigatorController {
  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly copilotService: CopilotService,
    private readonly knowledgeStore: KnowledgeStore
  ) {}

  public async initialize(): Promise<void> {
    await this.knowledgeStore.initialize();
  }

  public getViewState(mode: NavigatorViewState["mode"]): NavigatorViewState {
    return {
      connectionState: this.copilotService.getConnectionState(),
      mode,
      statusMessage: "Scaffold mode: services are placeholders and ready for implementation.",
      contextPreview: this.contextCollector.collectPreview()
    };
  }

  public async connectCopilot(): Promise<NavigatorViewState["connectionState"]> {
    return this.copilotService.connect();
  }

  public async askForGuidance(): Promise<string> {
    return this.copilotService.requestGuidance();
  }
}
