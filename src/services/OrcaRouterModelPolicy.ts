import type { OrcaRouterModelOption } from "../shared/types";
import type { OrcaRouterModel } from "./OrcaRouterClient";
import { MAX_PROVIDER_MODEL_COUNT } from "./AiRequestPolicy";

export function createBuiltInOrcaRouterOptions(): OrcaRouterModelOption[] {
  return [
    { id: "orcarouter/free", label: "Free Router", provider: "orcarouter", isRouter: true, billingCategory: "free" },
    { id: "orcarouter/auto", label: "Auto Router", provider: "orcarouter", isRouter: true, billingCategory: "metered" }
  ];
}

/** Validate only successfully fetched catalogs. Absence is a warning, not proof of retirement. */
export function toOrcaRouterModelOptions(models: OrcaRouterModel[]): OrcaRouterModelOption[] {
  const builtIns = createBuiltInOrcaRouterOptions();
  const listedIds = new Set(models.map((model) => model.id));
  for (const option of builtIns) {
    if (!listedIds.has(option.id)) {
      option.availabilityWarning = "取得したモデル一覧にありません。利用できない可能性があります。";
      console.warn("[OrcaRouter] Built-in router missing from model list; possible naming change or catalog omission.", { modelId: option.id });
    }
  }
  const options = new Map(builtIns.map((option) => [option.id, option]));
  for (const model of models) {
    const supportsOpenAi = model.supportedEndpointTypes.length === 0 || model.supportedEndpointTypes.includes("openai");
    const acceptsText = model.inputModalities.length === 0 || model.inputModalities.includes("text");
    const producesText = model.outputModalities.length === 0 || model.outputModalities.includes("text");
    if (!supportsOpenAi || !acceptsText || !producesText) {
      const builtIn = options.get(model.id);
      if (builtIn) {
        builtIn.availabilityWarning = "取得したモデル情報では、テキスト会話への対応を確認できません。";
        console.warn("[OrcaRouter] Built-in router capabilities do not support text chat.", { modelId: model.id });
      }
      continue;
    }
    const builtIn = options.get(model.id);
    options.set(model.id, {
      id: model.id,
      label: builtIn?.isRouter ? builtIn.label : model.id.split("/").slice(1).join("/") || model.id,
      provider: model.ownedBy,
      contextLength: model.contextLength,
      maxCompletionTokens: model.maxCompletionTokens,
      billingCategory: builtIn?.billingCategory ?? (model.id.endsWith("-free") ? "free" : "unknown"),
      ...(builtIn?.isRouter ? { isRouter: true } : {})
    });
  }
  return [...options.values()]
    .sort((a, b) => {
      if (a.isRouter !== b.isRouter) return a.isRouter ? -1 : 1;
      return a.label.localeCompare(b.label);
    })
    .slice(0, MAX_PROVIDER_MODEL_COUNT);
}
