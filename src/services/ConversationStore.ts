import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  AdviceMode,
  AiProviderId,
  AssistanceDepth,
  ConversationEntry,
  ConversationStreamListItem,
  GuidanceKind,
  NavigatorContextPreview,
  ProviderResponseMetadata,
  RequestPlanSnapshot,
  SlashCommand,
  SlashCommandScope,
  TokenUsage,
  FeedbackRating
} from "../shared/types";
import { isSlashCommand } from "../shared/skills";
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

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

const initSqlJs = require("sql.js") as (config?: {
  locateFile?: (file: string) => string;
}) => Promise<SqlJsStatic>;

const ACTIVE_STREAM_KEY = "active_stream_id";
const CONVERSATION_SCHEMA_VERSION = 1;
export const DEFAULT_CONVERSATION_STREAM_TITLE = "新しい相談";

interface ConversationStreamSummary extends ConversationStreamListItem {
  additionalContext?: string;
}

export interface ConversationStreamRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  entries: ConversationEntry[];
  additionalContext?: string;
  revision: number;
}

interface ConversationPruneResult {
  streamIds: string[];
  entryIds: string[];
}

export class ConversationRevisionConflictError extends Error {
  public constructor(public readonly streamId: string) {
    super(`Conversation stream ${streamId} was updated by another operation.`);
    this.name = "ConversationRevisionConflictError";
  }
}

export class ConversationStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;
  private readonly mutationQueue = new SerialTaskQueue();

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "conversations.sqlite");

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    this.db = await openDatabaseWithBackup(this.dbUri, SQL.Database);
    this.migrate();
    this.deleteEmptyStreamsInMemory();
    await this.persist();
  }

  public list(): ConversationStreamListItem[] {
    return this.selectStreamSummaries(
      `SELECT streams.id, streams.title, streams.created_at, streams.updated_at, streams.message_count, streams.last_message_preview, streams.additional_context
         FROM conversation_streams AS streams
        WHERE EXISTS (
          SELECT 1
            FROM conversation_entries AS entries
           WHERE entries.stream_id = streams.id
        )
        ORDER BY streams.updated_at DESC`
    );
  }

  public get(id: string): ConversationStreamRecord | undefined {
    const summary = this.selectStreamSummaries(
      `SELECT id, title, created_at, updated_at, message_count, last_message_preview, additional_context
         FROM conversation_streams
        WHERE id = ?
        LIMIT 1`,
      [id]
    )[0];

    if (!summary) {
      return undefined;
    }

    return {
      id: summary.id,
      title: summary.title,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      entries: this.selectEntries(id),
      additionalContext: summary.additionalContext,
      revision: this.selectRevision(id) ?? 0
    };
  }

  public findStreamByEntryId(entryId: string): ConversationStreamListItem | undefined {
    return this.selectStreamSummaries(
      `SELECT streams.id, streams.title, streams.created_at, streams.updated_at, streams.message_count, streams.last_message_preview, streams.additional_context
         FROM conversation_streams AS streams
         JOIN conversation_entries AS entries ON entries.stream_id = streams.id
        WHERE entries.id = ?
        LIMIT 1`,
      [entryId]
    )[0];
  }

  public listEntryIds(): string[] {
    return this.selectIds("SELECT id FROM conversation_entries", []);
  }

  public async createStream(title = DEFAULT_CONVERSATION_STREAM_TITLE): Promise<ConversationStreamRecord> {
    return this.mutationQueue.run(async () => {
      const now = new Date().toISOString();
      const record: ConversationStreamRecord = {
        id: this.createId(),
        title: this.normalizeTitle(title),
        createdAt: now,
        updatedAt: now,
        entries: [],
        additionalContext: undefined,
        revision: 0
      };

      this.getDb().run(
        `INSERT INTO conversation_streams
          (id, title, created_at, updated_at, message_count, last_message_preview, additional_context, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.title, record.createdAt, record.updatedAt, 0, null, null, record.revision]
      );
      await this.persist();
      return record;
    });
  }

  public async saveStream(record: ConversationStreamRecord): Promise<ConversationStreamRecord> {
    return this.mutationQueue.run(async () => {
      const currentRevision = this.selectRevision(record.id);
      if (currentRevision !== record.revision) {
        throw new ConversationRevisionConflictError(record.id);
      }
      const normalizedEntries = record.entries.map((entry) => ({ ...entry }));
      const nextRecord: ConversationStreamRecord = {
        ...record,
        title: this.normalizeTitle(record.title),
        updatedAt: this.resolveUpdatedAt(record.updatedAt, normalizedEntries),
        entries: normalizedEntries,
        additionalContext: this.normalizeOptionalText(record.additionalContext),
        revision: record.revision + 1
      };
      const lastMessagePreview = this.buildLastMessagePreview(normalizedEntries);

      this.inTransaction(() => {
        this.getDb().run(
          `INSERT INTO conversation_streams
        (id, title, created_at, updated_at, message_count, last_message_preview, additional_context, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         message_count = excluded.message_count,
         last_message_preview = excluded.last_message_preview,
         additional_context = excluded.additional_context,
         revision = excluded.revision`,
      [
        nextRecord.id,
        nextRecord.title,
        nextRecord.createdAt,
        nextRecord.updatedAt,
        nextRecord.entries.length,
        lastMessagePreview ?? null,
        nextRecord.additionalContext ?? null,
        nextRecord.revision
          ]
        );

        // 以前は毎回この会話の全エントリを削除して入れ直していた。1 メッセージ増えるたびに
        // 会話全体を書き直すことになるので、いなくなった行だけ消して残りは upsert する。
        this.deleteRemovedEntries(nextRecord.id, normalizedEntries.map((entry) => entry.id));
        normalizedEntries.forEach((entry, index) => {
          this.getDb().run(
            `INSERT INTO conversation_entries
          (id, stream_id, entry_order, role, text, created_at, kind, based_on_json, mode, assistance_depth, slash_command, slash_command_scope, request_plan_json, token_usage_json, provider_id, model_id, model_label, response_metadata_json, feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           stream_id = excluded.stream_id,
           entry_order = excluded.entry_order,
           role = excluded.role,
           text = excluded.text,
           created_at = excluded.created_at,
           kind = excluded.kind,
           based_on_json = excluded.based_on_json,
           mode = excluded.mode,
           assistance_depth = excluded.assistance_depth,
           slash_command = excluded.slash_command,
           slash_command_scope = excluded.slash_command_scope,
           request_plan_json = excluded.request_plan_json,
           token_usage_json = excluded.token_usage_json,
           provider_id = excluded.provider_id,
           model_id = excluded.model_id,
           model_label = excluded.model_label,
           response_metadata_json = excluded.response_metadata_json,
           feedback = excluded.feedback`,
            this.toEntryParams(nextRecord.id, index, entry)
          );
        });
      });

      await this.persist();
      return nextRecord;
    });
  }

  public async deleteStream(id: string): Promise<boolean> {
    return this.mutationQueue.run(async () => {
      const existed = Boolean(this.get(id));
      this.inTransaction(() => {
        this.getDb().run("DELETE FROM conversation_entries WHERE stream_id = ?", [id]);
        this.getDb().run("DELETE FROM conversation_streams WHERE id = ?", [id]);
        this.getDb().run("DELETE FROM conversation_metadata WHERE key = ? AND value = ?", [ACTIVE_STREAM_KEY, id]);
      });
      await this.persist();
      return existed;
    });
  }

  public async deleteAllStreams(): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.inTransaction(() => {
        this.getDb().run("DELETE FROM conversation_entries");
        this.getDb().run("DELETE FROM conversation_streams");
        this.getDb().run("DELETE FROM conversation_metadata");
      });
      await this.persist();
    });
  }

  public async pruneToLimit(maxStreams: number): Promise<ConversationPruneResult> {
    return this.mutationQueue.run(async () => {
      const limit = Math.max(0, Math.floor(maxStreams));
      const stmt = this.getDb().prepare(
        "SELECT id FROM conversation_streams ORDER BY updated_at DESC LIMIT -1 OFFSET ?"
      );
      const removedStreamIds: string[] = [];
      try {
        stmt.bind([limit]);
        while (stmt.step()) removedStreamIds.push(String(stmt.getAsObject().id));
      } finally {
        stmt.free();
      }
      if (removedStreamIds.length === 0) return { streamIds: [], entryIds: [] };

      const removedEntryIds: string[] = [];
      this.inTransaction(() => {
        for (let index = 0; index < removedStreamIds.length; index += 200) {
          const chunk = removedStreamIds.slice(index, index + 200);
          const placeholders = chunk.map(() => "?").join(", ");
          removedEntryIds.push(...this.selectIds(
            `SELECT id FROM conversation_entries WHERE stream_id IN (${placeholders})`,
            chunk
          ));
          this.getDb().run(
            `DELETE FROM conversation_entries WHERE stream_id IN (${placeholders})`,
            chunk
          );
          this.getDb().run(
            `DELETE FROM conversation_streams WHERE id IN (${placeholders})`,
            chunk
          );
        }
        this.getDb().run(
          `DELETE FROM conversation_metadata
            WHERE key = ?
              AND value NOT IN (SELECT id FROM conversation_streams)`,
          [ACTIVE_STREAM_KEY]
        );
      });
      await this.persist();
      return { streamIds: removedStreamIds, entryIds: removedEntryIds };
    });
  }

  public getActiveStreamId(): string | undefined {
    const stmt = this.getDb().prepare("SELECT value FROM conversation_metadata WHERE key = ? LIMIT 1");

    try {
      stmt.bind([ACTIVE_STREAM_KEY]);
      if (!stmt.step()) {
        return undefined;
      }

      const row = stmt.getAsObject();
      return row.value ? String(row.value) : undefined;
    } finally {
      stmt.free();
    }
  }

  public async setActiveStream(id: string): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.getDb().run(
        `INSERT INTO conversation_metadata (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [ACTIVE_STREAM_KEY, id]
      );
      await this.persist();
    });
  }

  public dispose(): void {
    this.db?.close();
    this.db = undefined;
  }

  private migrate(): void {
    const version = this.getUserVersion();
    this.getDb().run(`
      CREATE TABLE IF NOT EXISTS conversation_streams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT,
        additional_context TEXT,
        revision INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS conversation_entries (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        entry_order INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('manual', 'context', 'deep_dive', 'always')),
        based_on_json TEXT,
        mode TEXT,
        assistance_depth TEXT,
        slash_command TEXT,
        slash_command_scope TEXT,
        request_plan_json TEXT,
        guidance_context_json TEXT,
        token_usage_json TEXT,
        provider_id TEXT,
        model_id TEXT,
        model_label TEXT,
        response_metadata_json TEXT,
        feedback TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_stream_updated
        ON conversation_streams(updated_at);

      CREATE INDEX IF NOT EXISTS idx_conversation_entries_stream_order
        ON conversation_entries(stream_id, entry_order);

      CREATE TABLE IF NOT EXISTS conversation_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    this.ensureColumn("conversation_streams", "additional_context", "TEXT");
    this.ensureColumn("conversation_streams", "revision", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("conversation_entries", "assistance_depth", "TEXT");
    this.ensureColumn("conversation_entries", "slash_command", "TEXT");
    this.ensureColumn("conversation_entries", "slash_command_scope", "TEXT");
    this.ensureColumn("conversation_entries", "token_usage_json", "TEXT");
    this.ensureColumn("conversation_entries", "provider_id", "TEXT");
    this.ensureColumn("conversation_entries", "model_id", "TEXT");
    this.ensureColumn("conversation_entries", "model_label", "TEXT");
    this.ensureColumn("conversation_entries", "response_metadata_json", "TEXT");
    this.ensureColumn("conversation_entries", "feedback", "TEXT");

    if (version < CONVERSATION_SCHEMA_VERSION) {
      // 収集したソース断片や追加文脈は応答生成中だけメモリに保持し、履歴DBには残さない。
      // 旧版が保存した平文データはこの移行時に一度だけ消去する。
      this.getDb().run(`
        UPDATE conversation_entries
           SET guidance_context_json = NULL
         WHERE guidance_context_json IS NOT NULL;
        PRAGMA user_version = ${CONVERSATION_SCHEMA_VERSION};
      `);
    }
  }

  private getUserVersion(): number {
    const stmt = this.getDb().prepare("PRAGMA user_version");
    try {
      return stmt.step() ? Number(stmt.getAsObject().user_version ?? 0) : 0;
    } finally {
      stmt.free();
    }
  }

  private deleteEmptyStreamsInMemory(): void {
    this.getDb().run(
      `DELETE FROM conversation_streams
        WHERE NOT EXISTS (
          SELECT 1
            FROM conversation_entries
           WHERE conversation_entries.stream_id = conversation_streams.id
        )`
    );
    this.getDb().run(
      `DELETE FROM conversation_metadata
        WHERE key = ?
          AND value NOT IN (
            SELECT id
              FROM conversation_streams
          )`,
      [ACTIVE_STREAM_KEY]
    );
  }

  private selectStreamSummaries(sql: string, params: SqlValue[] = []): ConversationStreamSummary[] {
    const stmt = this.getDb().prepare(sql);
    const records: ConversationStreamSummary[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        records.push(this.summaryFromRow(stmt.getAsObject()));
      }
    } finally {
      stmt.free();
    }

    return records;
  }

  private selectEntries(streamId: string): ConversationEntry[] {
    const stmt = this.getDb().prepare(
      `SELECT id, role, text, created_at, kind, based_on_json, mode, assistance_depth, slash_command, slash_command_scope, request_plan_json, token_usage_json, provider_id, model_id, model_label, response_metadata_json, feedback
         FROM conversation_entries
        WHERE stream_id = ?
        ORDER BY entry_order ASC`
    );
    const entries: ConversationEntry[] = [];

    try {
      stmt.bind([streamId]);
      while (stmt.step()) {
        entries.push(this.entryFromRow(stmt.getAsObject()));
      }
    } finally {
      stmt.free();
    }

    return entries;
  }

  /** 保存後の一覧に残らないエントリだけを削除する。プレースホルダ数を抑えるため分割して実行する。 */
  private deleteRemovedEntries(streamId: string, keptEntryIds: readonly string[]): void {
    const keptIds = new Set(keptEntryIds);
    const removedIds = this.selectEntryIds(streamId).filter((id) => !keptIds.has(id));
    if (removedIds.length === 0) {
      return;
    }

    for (let index = 0; index < removedIds.length; index += 200) {
      const chunk = removedIds.slice(index, index + 200);
      this.getDb().run(
        `DELETE FROM conversation_entries
          WHERE stream_id = ?
            AND id IN (${chunk.map(() => "?").join(", ")})`,
        [streamId, ...chunk]
      );
    }
  }

  private selectEntryIds(streamId: string): string[] {
    return this.selectIds("SELECT id FROM conversation_entries WHERE stream_id = ?", [streamId]);
  }

  private selectIds(sql: string, params: SqlValue[]): string[] {
    const stmt = this.getDb().prepare(sql);
    const ids: string[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        ids.push(String(stmt.getAsObject().id));
      }
    } finally {
      stmt.free();
    }

    return ids;
  }

  private selectRevision(streamId: string): number | undefined {
    const stmt = this.getDb().prepare("SELECT revision FROM conversation_streams WHERE id = ? LIMIT 1");
    try {
      stmt.bind([streamId]);
      return stmt.step() ? Number(stmt.getAsObject().revision ?? 0) : undefined;
    } finally {
      stmt.free();
    }
  }

  private inTransaction(task: () => void): void {
    const db = this.getDb();
    db.run("BEGIN IMMEDIATE");
    try {
      task();
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  private summaryFromRow(row: Record<string, unknown>): ConversationStreamSummary {
    return {
      id: String(row.id),
      title: String(row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      messageCount: Number(row.message_count ?? 0),
      lastMessagePreview: row.last_message_preview ? String(row.last_message_preview) : undefined,
      additionalContext: this.normalizeOptionalText(row.additional_context)
    };
  }

  private entryFromRow(row: Record<string, unknown>): ConversationEntry {
    return {
      id: String(row.id),
      role: this.parseRole(row.role),
      text: String(row.text),
      createdAt: String(row.created_at),
      kind: this.parseGuidanceKind(row.kind),
      basedOn: this.parseJson<NavigatorContextPreview>(row.based_on_json),
      mode: this.parseMode(row.mode),
      assistanceDepth: this.parseAssistanceDepth(row.assistance_depth),
      slashCommand: this.parseSlashCommand(row.slash_command),
      slashCommandScope: this.parseSlashCommandScope(row.slash_command_scope),
      requestPlan: this.parseJson<RequestPlanSnapshot>(row.request_plan_json),
      tokenUsage: this.parseJson<TokenUsage>(row.token_usage_json),
      providerId: this.parseProviderId(row.provider_id),
      modelId: this.normalizeOptionalText(row.model_id),
      modelLabel: this.normalizeOptionalText(row.model_label),
      responseMetadata: this.parseJson<ProviderResponseMetadata>(row.response_metadata_json),
      feedback: this.parseFeedbackRating(row.feedback)
    };
  }

  private toEntryParams(streamId: string, index: number, entry: ConversationEntry): SqlValue[] {
    return [
      entry.id,
      streamId,
      index,
      entry.role,
      entry.text,
      entry.createdAt,
      entry.kind,
      entry.basedOn ? JSON.stringify(entry.basedOn) : null,
      entry.mode ?? null,
      entry.assistanceDepth ?? null,
      entry.slashCommand ?? null,
      entry.slashCommandScope ?? null,
      entry.requestPlan ? JSON.stringify(entry.requestPlan) : null,
      entry.tokenUsage ? JSON.stringify(entry.tokenUsage) : null,
      entry.providerId ?? null,
      entry.modelId ?? null,
      entry.modelLabel ?? null,
      entry.responseMetadata ? JSON.stringify(entry.responseMetadata) : null,
      entry.feedback ?? null
    ];
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    if (this.hasColumn(tableName, columnName)) {
      return;
    }

    this.getDb().run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const stmt = this.getDb().prepare(`PRAGMA table_info(${tableName})`);

    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (String(row.name) === columnName) {
          return true;
        }
      }
      return false;
    } finally {
      stmt.free();
    }
  }

  private parseRole(value: unknown): "user" | "assistant" {
    return value === "assistant" ? "assistant" : "user";
  }

  private parseMode(value: unknown): AdviceMode | undefined {
    return value === "always" || value === "manual" ? value : undefined;
  }

  private parseProviderId(value: unknown): AiProviderId | undefined {
    return value === "copilot" || value === "lmStudio" || value === "orcaRouter" ? value : undefined;
  }

  private parseAssistanceDepth(value: unknown): AssistanceDepth | undefined {
    return value === "low" || value === "high" ? value : undefined;
  }

  private parseSlashCommand(value: unknown): SlashCommand | undefined {
    return typeof value === "string" && isSlashCommand(value) ? value : undefined;
  }

  private parseSlashCommandScope(value: unknown): SlashCommandScope | undefined {
    return value === "standard" || value === "deep" ? value : undefined;
  }

  private parseGuidanceKind(value: unknown): GuidanceKind {
    switch (value) {
      case "manual":
      case "context":
      case "always":
        return value;
      default:
        return "manual";
    }
  }

  private parseFeedbackRating(value: unknown): FeedbackRating | undefined {
    return value === "good" || value === "bad" ? value : undefined;
  }

  private parseJson<T>(value: unknown): T | undefined {
    if (typeof value !== "string" || value.length === 0) {
      return undefined;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  private resolveUpdatedAt(currentUpdatedAt: string, entries: ConversationEntry[]): string {
    return entries.at(-1)?.createdAt ?? currentUpdatedAt ?? new Date().toISOString();
  }

  private buildLastMessagePreview(entries: ConversationEntry[]): string | undefined {
    const text = entries.at(-1)?.text.replace(/\s+/g, " ").trim();
    if (!text) {
      return undefined;
    }

    return text.length <= 120 ? text : `${text.slice(0, 120)}...`;
  }

  private normalizeTitle(value: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return DEFAULT_CONVERSATION_STREAM_TITLE;
    }

    return normalized.length <= 60 ? normalized : `${normalized.slice(0, 60)}...`;
  }

  private normalizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.replace(/\r\n/g, "\n").trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private async persist(): Promise<void> {
    if (!this.dbUri) {
      throw new Error("ConversationStore is not initialized.");
    }

    await writeFileAtomically(this.dbUri, this.getDb().export());
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("ConversationStore is not initialized.");
    }

    return this.db;
  }

  private createId(): string {
    return randomUUID();
  }
}
