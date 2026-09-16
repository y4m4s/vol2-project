import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { AiProviderId, FeedbackRating, RoutingTaskProfile, RoutingTaskPurpose } from "../shared/types";
import type { RoutingObservedStats } from "../shared/adaptiveProviderRouting";
import { MODEL_CAPABILITY_PROFILE_VERSION } from "../shared/modelCapabilityDefaults";
import { openDatabaseWithBackup, writeFileAtomically } from "./AtomicFileStorage";
import { SerialTaskQueue } from "./SerialTaskQueue";

type SqlValue = string | number | Uint8Array | null;
type SqlParams = SqlValue[] | Record<string, SqlValue>;

interface SqlJsStatement {
  bind(values?: SqlParams): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsDatabase {
  run(sql: string, params?: SqlParams): SqlJsDatabase;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic { Database: new (data?: Uint8Array) => SqlJsDatabase; }

const initSqlJs = require("sql.js") as (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
const ROUTING_SCHEMA_VERSION = 1;

export interface ProviderEvaluationKey {
  providerId: AiProviderId;
  modelId: string;
  taskPurpose: RoutingTaskPurpose;
}

export interface RoutingDecisionRecord {
  conversationId?: string;
  profile: RoutingTaskProfile;
  previousProviderId?: AiProviderId;
  selectedProviderId: AiProviderId;
  action: "stay" | "switch" | "stop";
  reasonCode: string;
  scoreDelta?: number;
}

export class ProviderEvaluationStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;
  private readonly mutationQueue = new SerialTaskQueue();

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "provider-routing.sqlite");
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    this.db = await openDatabaseWithBackup(this.dbUri, SQL.Database);
    this.migrate();
    await this.persist();
  }

  public getSuccessfulResponseCount(): number {
    const stmt = this.getDb().prepare("SELECT successful_response_count FROM routing_learning_state WHERE id = 1");
    try { return stmt.step() ? finiteInteger(stmt.getAsObject().successful_response_count) : 0; }
    finally { stmt.free(); }
  }

  public getStats(key: ProviderEvaluationKey): RoutingObservedStats | undefined {
    const stmt = this.getDb().prepare(`SELECT success_count, request_failure_count, format_failure_count,
      timeout_count, positive_feedback_count, negative_feedback_count, total_latency_ms
      FROM routing_model_stats WHERE provider_id = ? AND model_id = ? AND task_purpose = ?`);
    try {
      stmt.bind([key.providerId, normalizeModelId(key.modelId), key.taskPurpose]);
      if (!stmt.step()) return undefined;
      const row = stmt.getAsObject();
      return {
        successCount: finiteInteger(row.success_count),
        requestFailureCount: finiteInteger(row.request_failure_count),
        formatFailureCount: finiteInteger(row.format_failure_count),
        timeoutCount: finiteInteger(row.timeout_count),
        positiveFeedbackCount: finiteInteger(row.positive_feedback_count),
        negativeFeedbackCount: finiteInteger(row.negative_feedback_count),
        totalLatencyMs: finiteInteger(row.total_latency_ms)
      };
    } finally { stmt.free(); }
  }

  public async recordSuccess(key: ProviderEvaluationKey, latencyMs: number, formatRepaired: boolean, countLearning = true): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.inTransaction(() => {
        this.ensureStatsRow(key);
        this.getDb().run(`UPDATE routing_model_stats SET success_count = success_count + 1,
          format_failure_count = format_failure_count + ?, total_latency_ms = total_latency_ms + ?, updated_at = ?
          WHERE provider_id = ? AND model_id = ? AND task_purpose = ?`,
        [formatRepaired ? 1 : 0, clampInteger(latencyMs), new Date().toISOString(), key.providerId, normalizeModelId(key.modelId), key.taskPurpose]);
        if (countLearning) {
          this.getDb().run(`UPDATE routing_learning_state SET successful_response_count = successful_response_count + 1,
            profile_version = ?, updated_at = ? WHERE id = 1`,
          [MODEL_CAPABILITY_PROFILE_VERSION, new Date().toISOString()]);
        }
      });
      await this.persist();
    });
  }

  public async recordFailure(key: ProviderEvaluationKey, timedOut: boolean, formatFailed = false): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.ensureStatsRow(key);
      this.getDb().run(`UPDATE routing_model_stats SET request_failure_count = request_failure_count + 1,
        timeout_count = timeout_count + ?, format_failure_count = format_failure_count + ?, updated_at = ?
        WHERE provider_id = ? AND model_id = ? AND task_purpose = ?`,
      [timedOut ? 1 : 0, formatFailed ? 1 : 0, new Date().toISOString(), key.providerId, normalizeModelId(key.modelId), key.taskPurpose]);
      await this.persist();
    });
  }

  public async recordFeedback(entryId: string, key: ProviderEvaluationKey, rating: FeedbackRating): Promise<void> {
    if (!entryId.trim()) return;
    await this.mutationQueue.run(async () => {
      const previous = this.getFeedback(entryId);
      this.inTransaction(() => {
        if (previous) this.adjustFeedback(previous.key, previous.rating, -1);
        this.ensureStatsRow(key);
        this.adjustFeedback(key, rating, 1);
        this.getDb().run(`INSERT INTO routing_feedback
          (conversation_entry_id, provider_id, model_id, task_purpose, rating, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(conversation_entry_id) DO UPDATE SET provider_id = excluded.provider_id,
            model_id = excluded.model_id, task_purpose = excluded.task_purpose,
            rating = excluded.rating, updated_at = excluded.updated_at`,
        [entryId, key.providerId, normalizeModelId(key.modelId), key.taskPurpose, rating, new Date().toISOString()]);
      });
      await this.persist();
    });
  }

  public async recordDecision(record: RoutingDecisionRecord): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.getDb().run(`INSERT INTO routing_decisions
        (id, conversation_id, task_purpose, complexity, previous_provider_id, selected_provider_id,
         action, reason_code, score_delta, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), record.conversationId ?? null, record.profile.purpose, record.profile.complexity,
        record.previousProviderId ?? null, record.selectedProviderId, record.action, record.reasonCode,
        Number.isFinite(record.scoreDelta) ? record.scoreDelta! : null, new Date().toISOString()]);
      this.getDb().run(`DELETE FROM routing_decisions WHERE id IN (
        SELECT id FROM routing_decisions ORDER BY created_at DESC LIMIT -1 OFFSET 1000
      )`);
      await this.persist();
    });
  }

  public dispose(): void { this.db?.close(); this.db = undefined; }

  private migrate(): void {
    const db = this.getDb();
    const version = this.userVersion();
    if (version > ROUTING_SCHEMA_VERSION) throw new Error(`Unsupported routing database schema version: ${version}`);
    db.run(`
      CREATE TABLE IF NOT EXISTS routing_learning_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        successful_response_count INTEGER NOT NULL,
        profile_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO routing_learning_state (id, successful_response_count, profile_version, updated_at)
      VALUES (1, 0, ${MODEL_CAPABILITY_PROFILE_VERSION}, '${new Date(0).toISOString()}');
      CREATE TABLE IF NOT EXISTS routing_model_stats (
        provider_id TEXT NOT NULL, model_id TEXT NOT NULL, task_purpose TEXT NOT NULL,
        success_count INTEGER NOT NULL, request_failure_count INTEGER NOT NULL,
        format_failure_count INTEGER NOT NULL, timeout_count INTEGER NOT NULL,
        positive_feedback_count INTEGER NOT NULL, negative_feedback_count INTEGER NOT NULL,
        total_latency_ms INTEGER NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id, task_purpose)
      );
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id TEXT PRIMARY KEY, conversation_id TEXT, task_purpose TEXT NOT NULL, complexity TEXT NOT NULL,
        previous_provider_id TEXT, selected_provider_id TEXT NOT NULL, action TEXT NOT NULL,
        reason_code TEXT NOT NULL, score_delta REAL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routing_feedback (
        conversation_entry_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        task_purpose TEXT NOT NULL, rating TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = ${ROUTING_SCHEMA_VERSION};
    `);
  }

  private ensureStatsRow(key: ProviderEvaluationKey): void {
    this.getDb().run(`INSERT OR IGNORE INTO routing_model_stats
      (provider_id, model_id, task_purpose, success_count, request_failure_count, format_failure_count,
       timeout_count, positive_feedback_count, negative_feedback_count, total_latency_ms, updated_at)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?)`,
    [key.providerId, normalizeModelId(key.modelId), key.taskPurpose, new Date().toISOString()]);
  }

  private adjustFeedback(key: ProviderEvaluationKey, rating: FeedbackRating, delta: 1 | -1): void {
    this.ensureStatsRow(key);
    const column = rating === "good" ? "positive_feedback_count" : "negative_feedback_count";
    this.getDb().run(`UPDATE routing_model_stats SET ${column} = MAX(0, ${column} + ?), updated_at = ?
      WHERE provider_id = ? AND model_id = ? AND task_purpose = ?`,
    [delta, new Date().toISOString(), key.providerId, normalizeModelId(key.modelId), key.taskPurpose]);
  }

  private getFeedback(entryId: string): { key: ProviderEvaluationKey; rating: FeedbackRating } | undefined {
    const stmt = this.getDb().prepare(`SELECT provider_id, model_id, task_purpose, rating
      FROM routing_feedback WHERE conversation_entry_id = ?`);
    try {
      stmt.bind([entryId]);
      if (!stmt.step()) return undefined;
      const row = stmt.getAsObject();
      const providerId = parseProviderId(row.provider_id);
      const taskPurpose = parsePurpose(row.task_purpose);
      const rating = row.rating === "good" || row.rating === "bad" ? row.rating : undefined;
      if (!providerId || !taskPurpose || !rating) return undefined;
      return { key: { providerId, modelId: String(row.model_id), taskPurpose }, rating };
    } finally { stmt.free(); }
  }

  private inTransaction(action: () => void): void {
    this.getDb().run("BEGIN IMMEDIATE");
    try { action(); this.getDb().run("COMMIT"); }
    catch (error) { this.getDb().run("ROLLBACK"); throw error; }
  }

  private userVersion(): number {
    const stmt = this.getDb().prepare("PRAGMA user_version");
    try { return stmt.step() ? finiteInteger(stmt.getAsObject().user_version) : 0; }
    finally { stmt.free(); }
  }

  private async persist(): Promise<void> {
    if (!this.dbUri) throw new Error("Provider evaluation store is not initialized.");
    await writeFileAtomically(this.dbUri, this.getDb().export());
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) throw new Error("Provider evaluation store is not initialized.");
    return this.db;
  }
}

function normalizeModelId(value: string): string { return value.trim().slice(0, 500) || "unknown"; }
function clampInteger(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value))) : 0; }
function finiteInteger(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? clampInteger(value) : 0; }
function parseProviderId(value: unknown): AiProviderId | undefined {
  return value === "copilot" || value === "orcaRouter" || value === "lmStudio" || value === "ollama" ? value : undefined;
}
function parsePurpose(value: unknown): RoutingTaskPurpose | undefined {
  return value === "learning" || value === "explanation" || value === "implementation" || value === "review" || value === "riskAssessment" || value === "summarization" ? value : undefined;
}
