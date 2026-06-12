import * as vscode from "vscode";

const STORAGE_KEY = "aiPairNavigator.usage.daily";

// USD / 100万トークン。included モデル廃止後の AI Credits 消費の概算に使う
const MODEL_PRICES_PER_MTOK: Array<{ match: string; input: number; output: number }> = [
  { match: "gpt54nano", input: 0.2, output: 1.25 },
  { match: "gpt5mini", input: 0.25, output: 2.0 },
  { match: "raptormini", input: 0.25, output: 2.0 },
  { match: "gemini3flash", input: 0.5, output: 3.0 }
];

const FALLBACK_PRICE_PER_MTOK = { input: 0.25, output: 2.0 };

export interface DailyUsage {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageRecordEntry {
  inputTokens: number;
  outputTokens: number;
}

export class UsageMeter {
  public constructor(private readonly storage: vscode.Memento) {}

  public getToday(): DailyUsage {
    const saved = this.storage.get<Partial<DailyUsage>>(STORAGE_KEY);
    const today = this.todayKey();

    if (!saved || saved.date !== today) {
      return { date: today, requestCount: 0, inputTokens: 0, outputTokens: 0 };
    }

    return {
      date: today,
      requestCount: this.toNonNegative(saved.requestCount),
      inputTokens: this.toNonNegative(saved.inputTokens),
      outputTokens: this.toNonNegative(saved.outputTokens)
    };
  }

  public async record(entry: UsageRecordEntry): Promise<void> {
    const current = this.getToday();
    const next: DailyUsage = {
      date: current.date,
      requestCount: current.requestCount + 1,
      inputTokens: current.inputTokens + this.toNonNegative(entry.inputTokens),
      outputTokens: current.outputTokens + this.toNonNegative(entry.outputTokens)
    };

    await this.storage.update(STORAGE_KEY, next);
  }

  public isBudgetExceeded(modelIdentifier: string | undefined, budgetUsd: number): boolean {
    if (budgetUsd <= 0) {
      return false;
    }

    return this.estimateCostUsd(modelIdentifier) >= budgetUsd;
  }

  public estimateCostUsd(
    modelIdentifier: string | undefined,
    usage: Pick<DailyUsage, "inputTokens" | "outputTokens"> = this.getToday()
  ): number {
    const price = this.resolvePrice(modelIdentifier);
    return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  }

  // 入出力の実測比率(なければ入力8割と仮定)で重みづけした、100万トークンあたりの実効単価
  public estimateBlendedPricePerMTokUsd(modelIdentifier: string | undefined, usage = this.getToday()): number {
    const price = this.resolvePrice(modelIdentifier);
    const total = usage.inputTokens + usage.outputTokens;
    const inputRatio = total > 0 ? usage.inputTokens / total : 0.8;
    return price.input * inputRatio + price.output * (1 - inputRatio);
  }

  private resolvePrice(modelIdentifier: string | undefined): { input: number; output: number } {
    if (!modelIdentifier) {
      return FALLBACK_PRICE_PER_MTOK;
    }

    const normalized = modelIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return MODEL_PRICES_PER_MTOK.find((entry) => normalized.includes(entry.match)) ?? FALLBACK_PRICE_PER_MTOK;
  }

  private todayKey(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private toNonNegative(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
}
