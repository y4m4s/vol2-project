import * as vscode from "vscode";
import type { AiProviderId, ConversationEntry, NavigatorSettings, ConversationRoutingPreference } from "../../shared/types";
import type { ConversationStore } from "../../services/ConversationStore";
import type { ConnectionService } from "../../services/ConnectionService";
import type { UsageMeter } from "../../services/UsageMeter";
import { deriveModelProfile } from "../../services/ModelProfile";
import { decideProviderRoute, normalizeRoutingSettings, PROVIDER_IDS, PROVIDER_LABELS } from "../../services/ProviderRouting";

export class ProviderRoutingCoordinator {
  private readonly pins = new Map<string, AiProviderId>();
  private readonly selected = new Map<string, AiProviderId>();
  private readonly preferences = new Map<string, ConversationRoutingPreference>();
  private readonly once = new Map<string, AiProviderId>();
  public constructor(private readonly connection: ConnectionService, private readonly usage: UsageMeter, private readonly store?: ConversationStore) {}
  public preference(stream?: string): ConversationRoutingPreference | undefined {
    return stream ? this.preferences.get(stream) ?? this.store?.getRoutingPreference(stream) : undefined;
  }
  public async setPreference(stream: string, value: ConversationRoutingPreference): Promise<void> {
    await this.store?.saveRoutingPreference(stream, value);
    this.preferences.set(stream, value);
    if (value.providerId) this.pins.set(stream, value.providerId); else this.pins.delete(stream);
  }
  public selectOnce(stream: string, provider: AiProviderId): void { this.once.set(stream, provider); }
  public async pin(stream: string, provider?: AiProviderId): Promise<void> {
    if (provider) this.pins.set(stream, provider); else this.pins.delete(stream);
    await this.setPreference(stream, { ...this.preference(stream), providerId: provider });
  }
  public async prepare(settings: NavigatorSettings, history: ConversationEntry[], stream: string | undefined, question = "", cancelled: () => boolean = () => false): Promise<{ ok: boolean; reason?: string }> {
    const routing = normalizeRoutingSettings(settings.routing);
    const preference = this.preference(stream);
    if (preference?.mode) routing.mode = preference.mode;
    const oneShot = stream ? this.once.get(stream) : undefined;
    if (routing.mode === "manual" && !oneShot && !preference?.providerId) return { ok: this.connection.getState() === "connected" };
    const current = this.connection.getProviderId();
    const models = this.connection.getTestedModels(settings);
    const candidates = PROVIDER_IDS.map(providerId => {
      const model = models.find(m => m.providerId === providerId);
      const usage = this.usage.getToday(providerId);
      return { providerId, available: Boolean(model), usedTokens: usage.inputTokens + usage.outputTokens,
        // 自動切り替えも設定画面の「NaviCom内の概算使用量ガード」を共通で使う。
        // 切り替え専用の上限を持つと、同じ意味の設定が二重管理になるため。
        tokenLimit: settings.dailyTokenLimit,
        maxInputTokens: model ? deriveModelProfile(model.profileSource).contextBudget : 0,
        costUsd: usage.requestCount === 0 ? 0 : this.usage.getRecordedCostUsd(providerId),
        verifiedLocal: Boolean(model && (providerId === "ollama" || providerId === "lmStudio") &&
          /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(model.endpoint ?? "") && !/cloud/i.test(model.modelId)) };
    });
    const localOnly = history.some(e => e.transmissionClass === "localOnly" ||
      (!e.transmissionClass && (e.providerId === "ollama" || e.providerId === "lmStudio")));
    const requiredHistoryChars = history.length ? JSON.stringify(history.filter(e => e.role === "user").map(e => ({ id: e.id, role: e.role, text: e.text }))).length + 250 : 0;
    const estimated = Math.max(Math.ceil(question.length / 3) + 2000, Math.ceil(requiredHistoryChars / (3 * 0.35)) + 2000);
    const pinned = oneShot ?? (stream ? this.pins.get(stream) : undefined) ?? preference?.providerId;
    const remembered = stream ? this.selected.get(stream) ?? [...history].reverse().find(e => e.role === "assistant")?.providerId : undefined;
    const route = decideProviderRoute(routing, candidates, pinned ?? remembered ?? (history.length ? current : routing.preferredProviderId ?? current), estimated, localOnly, Boolean(pinned));
    if (route.action === "stop") return { ok: false, reason: route.reason };
    let target = route.providerId;
    if (route.action === "suggest" || (routing.mode === "automaticSuggest" && target !== current && !pinned)) {
      const canKeep = candidates.some(c => c.providerId === current && c.available && c.maxInputTokens >= estimated && routing.allowedProviderIds.includes(current) && (!localOnly || c.verifiedLocal));
      const choice = await vscode.window.showInformationMessage(
        `${route.reason} ${PROVIDER_LABELS[target!]}へ切り替えますか？ 要件・直近履歴を引き継ぎます（入力概算 ${estimated.toLocaleString()}トークン）。`,
        { modal: true }, "切り替える", ...(canKeep ? ["今回は維持", "この相談では維持"] : [])
      );
      if (choice !== "切り替える") {
        if (!canKeep || (choice !== "今回は維持" && choice !== "この相談では維持")) return { ok: false, reason: "切り替えと送信を中止しました。" };
        target = current;
        if (choice === "この相談では維持" && stream) await this.pin(stream, current);
      }
    }
    if (cancelled()) return { ok: false, reason: "送信を中止しました。" };
    if (target && (target !== current || this.connection.getState() !== "connected")) {
      if (!this.connection.activateTestedProvider(target, settings)) return { ok: false, reason: "切り替え先の接続を再確認してください。" };
      if (stream) this.selected.set(stream, oneShot ? remembered ?? current : target);
      if (stream) this.once.delete(stream);
      return { ok: true, reason: `${PROVIDER_LABELS[target]}へ${routing.mode === "automatic" ? "自動" : ""}切り替え: ${route.reason}` };
    }
    if (stream && target) this.selected.set(stream, oneShot ? remembered ?? current : target);
    if (stream) this.once.delete(stream);
    return { ok: true };
  }
}
