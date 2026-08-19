import * as vscode from "vscode";
import { AiProviderId } from "../shared/types";

const STORAGE_KEY = "aiPairNavigator.usage.daily";

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

interface UsageBucket extends DailyUsage {
  providerId: AiProviderId;
  modelId?: string;
}

interface StoredDailyUsage extends DailyUsage {
  buckets?: UsageBucket[];
}

export interface UsageRecordEntry {
  providerId?: AiProviderId;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
}

export class UsageMeter {
  public constructor(private readonly storage: vscode.Memento) {}

  public getToday(providerId?: AiProviderId): DailyUsage {
    const stored = this.getStoredToday();
    const buckets = this.getBuckets(stored).filter((bucket) => !providerId || bucket.providerId === providerId);
    return this.aggregate(stored.date, buckets);
  }

  public async record(entry: UsageRecordEntry): Promise<void> {
    const current = this.getStoredToday();
    const providerId = entry.providerId ?? "copilot";
    const modelId = entry.modelId?.trim() || undefined;
    const buckets = this.getBuckets(current);
    const index = buckets.findIndex((bucket) => bucket.providerId === providerId && bucket.modelId === modelId);
    const currentBucket = index >= 0
      ? buckets[index]
      : { date: current.date, providerId, modelId, requestCount: 0, inputTokens: 0, outputTokens: 0 };
    const nextBucket: UsageBucket = {
      ...currentBucket,
      requestCount: currentBucket.requestCount + 1,
      inputTokens: currentBucket.inputTokens + this.toNonNegative(entry.inputTokens),
      outputTokens: currentBucket.outputTokens + this.toNonNegative(entry.outputTokens)
    };
    if (index >= 0) {
      buckets[index] = nextBucket;
    } else {
      buckets.push(nextBucket);
    }

    const total = this.aggregate(current.date, buckets);
    await this.storage.update(STORAGE_KEY, { ...total, buckets } satisfies StoredDailyUsage);
  }

  public isBudgetExceeded(providerId: AiProviderId, budgetUsd: number): boolean {
    return providerId === "copilot" && budgetUsd > 0 && this.estimateCostUsd(providerId) >= budgetUsd;
  }

  public estimateCostUsd(
    providerId: AiProviderId,
    modelId?: string,
    usage?: Pick<DailyUsage, "inputTokens" | "outputTokens">
  ): number {
    if (providerId === "lmStudio") {
      return 0;
    }
    if (usage) {
      return this.estimateUsageCost(modelId, usage);
    }
    return this.getBuckets(this.getStoredToday())
      .filter((bucket) => bucket.providerId === providerId)
      .reduce((total, bucket) => total + this.estimateUsageCost(bucket.modelId, bucket), 0);
  }

  public estimateBlendedPricePerMTokUsd(providerId: AiProviderId): number {
    const usage = this.getToday(providerId);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    return totalTokens > 0 ? (this.estimateCostUsd(providerId) * 1_000_000) / totalTokens : 0;
  }

  private getStoredToday(): StoredDailyUsage {
    const saved = this.storage.get<Partial<StoredDailyUsage>>(STORAGE_KEY);
    const date = this.todayKey();
    if (!saved || saved.date !== date) {
      return { date, requestCount: 0, inputTokens: 0, outputTokens: 0, buckets: [] };
    }
    return {
      date,
      requestCount: this.toNonNegative(saved.requestCount),
      inputTokens: this.toNonNegative(saved.inputTokens),
      outputTokens: this.toNonNegative(saved.outputTokens),
      buckets: Array.isArray(saved.buckets) ? saved.buckets : undefined
    };
  }

  private getBuckets(stored: StoredDailyUsage): UsageBucket[] {
    if (stored.buckets) {
      return stored.buckets.flatMap((bucket) => {
        if (bucket?.providerId !== "copilot" && bucket?.providerId !== "lmStudio") return [];
        return [{
          date: stored.date,
          providerId: bucket.providerId,
          modelId: typeof bucket.modelId === "string" && bucket.modelId.trim() ? bucket.modelId.trim() : undefined,
          requestCount: this.toNonNegative(bucket.requestCount),
          inputTokens: this.toNonNegative(bucket.inputTokens),
          outputTokens: this.toNonNegative(bucket.outputTokens)
        }];
      });
    }

    // Legacy single-bucket records originated before provider support and are Copilot usage.
    if (stored.requestCount || stored.inputTokens || stored.outputTokens) {
      return [{
        date: stored.date,
        providerId: "copilot",
        requestCount: stored.requestCount,
        inputTokens: stored.inputTokens,
        outputTokens: stored.outputTokens
      }];
    }
    return [];
  }

  private aggregate(date: string, buckets: UsageBucket[]): DailyUsage {
    return buckets.reduce<DailyUsage>(
      (total, bucket) => ({
        date,
        requestCount: total.requestCount + bucket.requestCount,
        inputTokens: total.inputTokens + bucket.inputTokens,
        outputTokens: total.outputTokens + bucket.outputTokens
      }),
      { date, requestCount: 0, inputTokens: 0, outputTokens: 0 }
    );
  }

  private estimateUsageCost(modelId: string | undefined, usage: Pick<DailyUsage, "inputTokens" | "outputTokens">): number {
    const price = this.resolvePrice(modelId);
    return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  }

  private resolvePrice(modelId: string | undefined): { input: number; output: number } {
    if (!modelId) return FALLBACK_PRICE_PER_MTOK;
    const normalized = modelId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return MODEL_PRICES_PER_MTOK.find((entry) => normalized.includes(entry.match)) ?? FALLBACK_PRICE_PER_MTOK;
  }

  private todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
  }

  private toNonNegative(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
}
