import { AdviceService } from "../../services/AdviceService";
import { ConnectionService } from "../../services/ConnectionService";
import { ConversationStore } from "../../services/ConversationStore";
import { KnowledgeStore } from "../../services/KnowledgeStore";
import {
  ConversationEntry,
  GuidanceContext,
  KnowledgeDetailViewData,
  KnowledgeListItem,
  NavigatorSessionState
} from "../../shared/types";

export interface KnowledgeCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  getCurrentModelLabel(): string | undefined;
  getGuidanceContext(entryId: string): GuidanceContext | undefined;
}

export class KnowledgeCoordinator {
  public constructor(
    private readonly knowledgeStore: KnowledgeStore,
    private readonly conversationStore: ConversationStore,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly host: KnowledgeCoordinatorHost
  ) {}

  public buildItems(state: NavigatorSessionState): KnowledgeListItem[] {
    return this.knowledgeStore.list({ query: state.knowledgeQuery }).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      providerId: item.providerId,
      modelId: item.modelId,
      modelLabel: item.modelLabel,
      updatedAt: item.updatedAt
    }));
  }

  public buildSelected(state: NavigatorSessionState): KnowledgeDetailViewData | undefined {
    const selected = state.selectedKnowledgeId ? this.knowledgeStore.get(state.selectedKnowledgeId) : undefined;
    if (!selected) return undefined;
    const sourceConversation = selected.sourceAdviceId
      ? this.conversationStore.findStreamByEntryId(selected.sourceAdviceId)
      : undefined;
    return {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      providerId: selected.providerId,
      modelId: selected.modelId,
      modelLabel: selected.modelLabel,
      body: selected.body,
      createdAt: selected.createdAt,
      updatedAt: selected.updatedAt,
      sourceConversation,
      sourceConversationDeleted: Boolean(selected.sourceAdviceId && !sourceConversation)
    };
  }

  public search(query: string): void {
    this.host.patchSession({ knowledgeQuery: query, selectedKnowledgeId: undefined });
  }

  public select(id: string): void {
    const record = this.knowledgeStore.get(id);
    if (!record) {
      this.host.patchSession({
        selectedKnowledgeId: undefined,
        statusMessage: { kind: "warning", text: "表示するナレッジが見つかりません。" }
      });
      return;
    }
    const state = this.host.getState();
    this.host.patchSession({
      screen: "knowledge_detail",
      screenHistory: state.screen === "knowledge_detail" ? state.screenHistory : [...state.screenHistory, state.screen],
      selectedKnowledgeId: id,
      statusMessage: undefined
    });
  }

  public async save(conversationId?: string): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") return;
    const source = conversationId
      ? state.conversationHistory.find((entry) => entry.id === conversationId && entry.role === "assistant")
      : findSelectedConversation(state) ?? findLatestAssistant(state.conversationHistory);
    if (!source) {
      this.host.patchSession({ statusMessage: { kind: "warning", text: "保存できるアドバイスがまだありません。" } });
      return;
    }

    const existing = this.knowledgeStore.getBySourceAdviceId(source.id);
    if (existing) {
      this.host.patchSession({
        selectedKnowledgeId: existing.id,
        statusMessage: { kind: "info", text: "このアドバイスはすでにナレッジ化されています。" }
      });
      return;
    }

    this.host.patchSession({
      requestState: "saving_knowledge",
      statusMessage: { kind: "info", text: "接続中の AI でアドバイスをナレッジ用に整理しています..." }
    });
    const model = this.connectionService.getConnectedModel();
    const modelLabel = this.host.getCurrentModelLabel();
    const draftResult = await this.adviceService.createKnowledgeDraft({
      source: { ...source, context: this.host.getGuidanceContext(source.id) },
      conversation: buildConversationWindow(state, source)
    });
    if (!draftResult.ok) {
      this.host.patchSession({
        requestState: "idle",
        connectionState: draftResult.connectionState,
        statusMessage: {
          kind: draftResult.connectionState === "restricted" || draftResult.connectionState === "unavailable" ? "error" : "warning",
          text: draftResult.message
        }
      });
      return;
    }

    const record = await this.knowledgeStore.create({
      title: draftResult.draft.title,
      summary: draftResult.draft.summary,
      body: draftResult.draft.body,
      sourceAdviceId: source.id,
      providerId: model?.providerId,
      modelId: model?.modelId,
      modelLabel
    });
    this.host.patchSession({
      requestState: "idle",
      ...(conversationId ? {} : { screen: "knowledge" as const }),
      selectedKnowledgeId: record.id,
      statusMessage: { kind: "info", text: "アドバイスを整理してナレッジとして保存しました。" }
    });
  }

  public async update(input: { id: string; title: string; summary: string; body: string }): Promise<void> {
    const updated = await this.knowledgeStore.update(input.id, {
      title: input.title,
      summary: input.summary,
      body: input.body
    });
    this.host.patchSession({
      selectedKnowledgeId: updated?.id,
      statusMessage: {
        kind: updated ? "info" : "warning",
        text: updated ? "ナレッジを保存しました。" : "更新対象のナレッジが見つかりません。"
      }
    });
  }

  public async delete(id: string): Promise<void> {
    const state = this.host.getState();
    const deleted = await this.knowledgeStore.delete(id);
    this.host.patchSession({
      selectedKnowledgeId: state.selectedKnowledgeId === id ? undefined : state.selectedKnowledgeId,
      ...(state.screen === "knowledge_detail" && state.selectedKnowledgeId === id ? { screen: "knowledge" as const } : {}),
      statusMessage: {
        kind: deleted ? "info" : "warning",
        text: deleted ? "ナレッジを削除しました。" : "削除対象のナレッジが見つかりません。"
      }
    });
  }
}

function findSelectedConversation(state: NavigatorSessionState): ConversationEntry | undefined {
  return state.selectedConversationId
    ? state.conversationHistory.find((entry) => entry.id === state.selectedConversationId && entry.role === "assistant")
    : undefined;
}

function findLatestAssistant(history: ConversationEntry[]): ConversationEntry | undefined {
  return [...history].reverse().find((entry) => entry.role === "assistant");
}

function buildConversationWindow(state: NavigatorSessionState, source: ConversationEntry): ConversationEntry[] {
  const sourceIndex = state.conversationHistory.findIndex((entry) => entry.id === source.id);
  if (sourceIndex < 0) return [source];
  return state.conversationHistory.slice(Math.max(0, sourceIndex - 4), Math.min(state.conversationHistory.length, sourceIndex + 3));
}
