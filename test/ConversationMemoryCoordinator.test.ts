import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { ConnectedProviderModel } from "../src/services/ConnectionService";
import type { ConversationStore } from "../src/services/ConversationStore";
import type { UsageMeter } from "../src/services/UsageMeter";
import type { AiProviderId, ConversationEntry, NavigatorSettings } from "../src/shared/types";

const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (id, parent, isMain) => id === "vscode" ? {
  CancellationTokenSource: class {
    public token = { isCancellationRequested: false };
    public cancel(): void { this.token.isCancellationRequested = true; }
    public dispose(): void {}
  }
} : originalLoad(id, parent, isMain);
const { ConversationMemoryCoordinator } = require("../src/application/coordinators/ConversationMemoryCoordinator") as typeof import("../src/application/coordinators/ConversationMemoryCoordinator");
loader._load = originalLoad;

const entries: ConversationEntry[] = Array.from({ length: 10 }, (_, index) => ({
  id: String(index),
  role: index % 2 === 0 ? "user" : "assistant",
  text: `会話${index}`,
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "manual",
  transmissionClass: "cloudAllowed"
}));

function createModel(providerId: AiProviderId, calls: AiProviderId[]): ConnectedProviderModel {
  return {
    providerId,
    modelId: `${providerId}-model`,
    modelLabel: `${providerId} model`,
    profileSource: { maxInputTokens: 32768 },
    endpoint: providerId === "lmStudio" ? "http://127.0.0.1:1234" : undefined,
    requestText: async request => {
      calls.push(providerId);
      assert.equal(request.maxOutputTokens, 2048);
      const payload = JSON.parse(request.userPrompt) as { entries: Array<{ id: string }> };
      return { text: JSON.stringify([{ text: "要約", sourceEntryIds: [payload.entries[0].id] }]) };
    }
  };
}

function createHarness(activeProvider: AiProviderId, allowedProviderIds: AiProviderId[]) {
  const calls: AiProviderId[] = [];
  const models = [createModel("copilot", calls), createModel("orcaRouter", calls), createModel("lmStudio", calls)];
  const saved: Array<{ sourceIds: string[] }> = [];
  const store = {
    get: () => ({ revision: 1, entries }),
    getMemory: () => undefined,
    saveMemory: async (_stream: string, _revision: number, sourceIds: string[]) => {
      saved.push({ sourceIds });
      return true;
    }
  } as unknown as ConversationStore;
  const connection = {
    getTestedModels: () => models,
    getConnectedModel: () => models.find(model => model.providerId === activeProvider)
  };
  const coordinator = new ConversationMemoryCoordinator(connection as never, store, {
    record: async () => {}
  } as unknown as UsageMeter);
  const settings = {
    protectedExcludedGlobs: [],
    excludedGlobs: [],
    routing: {
      mode: "automatic",
      allowedProviderIds,
      preferredProviderId: allowedProviderIds[0],
      localHelperProviderId: "lmStudio"
    }
  } as unknown as NavigatorSettings;
  return { calls, coordinator, saved, settings };
}

test("the local command immediately uses the configured tested local model", async () => {
  const harness = createHarness("copilot", ["copilot", "lmStudio"]);
  const result = await harness.coordinator.compactNow(harness.settings, entries, "stream", "local");
  assert.equal(result.status, "saved");
  assert.equal(result.providerId, "lmStudio");
  assert.deepEqual(harness.calls, ["lmStudio"]);
  assert.deepEqual(harness.saved[0].sourceIds, ["0", "1"]);
});

test("the without-local command never calls a tested local model", async () => {
  const harness = createHarness("lmStudio", ["orcaRouter", "lmStudio"]);
  const result = await harness.coordinator.compactNow(harness.settings, entries, "stream", "withoutLocal");
  assert.equal(result.status, "saved");
  assert.equal(result.providerId, "orcaRouter");
  assert.deepEqual(harness.calls, ["orcaRouter"]);
});

test("the without-local command blocks local-only conversation history", async () => {
  const harness = createHarness("copilot", ["copilot", "lmStudio"]);
  const localEntries = entries.map((entry, index) => index === 0 ? { ...entry, transmissionClass: "localOnly" as const } : entry);
  const result = await harness.coordinator.compactNow(harness.settings, localEntries, "stream", "withoutLocal");
  assert.equal(result.status, "blocked");
  assert.deepEqual(harness.calls, []);
});
