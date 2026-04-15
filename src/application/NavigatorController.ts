import { ContextCollector } from "../services/ContextCollector";
import { CopilotService } from "../services/CopilotService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import { AdviceMode, NavigatorViewState } from "../shared/types";

export class NavigatorController {
  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly copilotService: CopilotService,
    private readonly knowledgeStore: KnowledgeStore
  ) {}

  public async initialize(): Promise<void> {
    await this.knowledgeStore.initialize();
  }

  public getViewState(mode: AdviceMode): NavigatorViewState {
    return {
      connectionState: this.copilotService.getConnectionState(),
      mode,
      statusMessage: "",
      contextPreview: this.contextCollector.collectPreview()
    };
  }

  public async connectCopilot(): Promise<NavigatorViewState["connectionState"]> {
    return this.copilotService.connect();
  }

  public async askForGuidance(mode: AdviceMode): Promise<string> {
    const context = this.contextCollector.collectPreview();
    return this.copilotService.requestGuidance(context, mode);
  }
}
