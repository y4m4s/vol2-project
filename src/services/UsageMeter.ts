import * as vscode from "vscode";
import { AiProviderId } from "../shared/types";

const STORAGE_KEY = "aiPairNavigator.usage.daily";

export interface DailyUsage {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageBucket extends DailyUsage {
  providerId: AiProviderId;
  modelId?: string;
  costUsd?: number;
  costedRequestCount?: number;
}

interface StoredDailyUsage extends DailyUsage {
  buckets?: UsageBucket[];
}

export interface UsageRecordEntry {
  providerId?: AiProviderId;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
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
      outputTokens: currentBucket.outputTokens + this.toNonNegative(entry.outputTokens),
      costUsd: currentBucket.costUsd !== undefined || entry.costUsd !== undefined
        ? this.toNonNegativeNumber(currentBucket.costUsd) + this.toNonNegativeNumber(entry.costUsd)
        : undefined,
      costedRequestCount: this.toNonNegative(currentBucket.costedRequestCount) + (entry.costUsd !== undefined ? 1 : 0)
    };
    if (index >= 0) {
      buckets[index] = nextBucket;
    } else {
      buckets.push(nextBucket);
    }

    const total = this.aggregate(current.date, buckets);
    await this.storage.update(STORAGE_KEY, { ...total, buckets } satisfies StoredDailyUsage);
  }

  /**
   * 上限は全プロバイダーに適用する。
   *
   * 以前は Copilot 限定だったため、実費が発生する OrcaRouter で常時モードの自動送信を
   * 止める仕組みが存在しなかった。ローカル実行の LM Studio も含めて同じ上限で扱う
   * （送信量そのものを抑えるための設定であり、課金の有無とは別の目的のため）。
   */
  public isTokenLimitExceeded(providerId: AiProviderId, tokenLimit: number): boolean {
    if (tokenLimit <= 0) {
      return false;
    }

    const usage = this.getToday(providerId);
    return usage.inputTokens + usage.outputTokens >= tokenLimit;
  }

  public getRecordedCostUsd(providerId: AiProviderId): number | undefined {
    if (providerId === "lmStudio") {
      return 0;
    }
    const buckets = this.getBuckets(this.getStoredToday()).filter((bucket) => bucket.providerId === providerId);
    if (buckets.length === 0) return undefined;
    if (buckets.some((bucket) => bucket.costUsd === undefined || bucket.costedRequestCount !== bucket.requestCount)) {
      return undefined;
    }
    return buckets.reduce((total, bucket) => total + (bucket.costUsd ?? 0), 0);
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
        if (bucket?.providerId !== "copilot" && bucket?.providerId !== "lmStudio" && bucket?.providerId !== "orcaRouter") return [];
        return [{
          date: stored.date,
          providerId: bucket.providerId,
          modelId: typeof bucket.modelId === "string" && bucket.modelId.trim() ? bucket.modelId.trim() : undefined,
          requestCount: this.toNonNegative(bucket.requestCount),
          inputTokens: this.toNonNegative(bucket.inputTokens),
          outputTokens: this.toNonNegative(bucket.outputTokens),
          costUsd: typeof bucket.costUsd === "number" && Number.isFinite(bucket.costUsd) && bucket.costUsd >= 0
            ? bucket.costUsd
            : undefined,
          costedRequestCount: this.toNonNegative(bucket.costedRequestCount)
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

  private todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
  }

  private toNonNegative(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  private toNonNegativeNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  }
}
