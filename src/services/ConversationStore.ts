import * as vscode from "vscode";
import {
  AdviceMode,
  ConversationEntry,
  ConversationStreamListItem,
  GuidanceContext,
  GuidanceKind,
  NavigatorContextPreview,
  RequestPlanSnapshot
} from "../shared/types";

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
export const DEFAULT_CONVERSATION_STREAM_TITLE = "新しい相談";

export interface StoredConversationEntry extends ConversationEntry {
  guidanceContext?: GuidanceContext;
}

interface ConversationStreamSummary extends ConversationStreamListItem {
  additionalContext?: string;
}

export interface ConversationStreamRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  entries: StoredConversationEntry[];
  additionalContext?: string;
}

export class ConversationStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "conversations.sqlite");

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    const existingBytes = await this.readExistingDatabase();
    this.db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
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
      additionalContext: summary.additionalContext
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

  public async createStream(title = DEFAULT_CONVERSATION_STREAM_TITLE): Promise<ConversationStreamRecord> {
    const now = new Date().toISOString();
    const record: ConversationStreamRecord = {
      id: this.createId(),
      title: this.normalizeTitle(title),
      createdAt: now,
      updatedAt: now,
      entries: [],
      additionalContext: undefined
    };

    this.getDb().run(
      `INSERT INTO conversation_streams
        (id, title, created_at, updated_at, message_count, last_message_preview, additional_context)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.title, record.createdAt, record.updatedAt, 0, null, null]
    );
    await this.persist();
    return record;
  }

  public async saveStream(record: ConversationStreamRecord): Promise<ConversationStreamRecord> {
    const normalizedEntries = record.entries.map((entry) => ({ ...entry }));
    const nextRecord: ConversationStreamRecord = {
      ...record,
      title: this.normalizeTitle(record.title),
      updatedAt: this.resolveUpdatedAt(record.updatedAt, normalizedEntries),
      entries: normalizedEntries,
      additionalContext: this.normalizeOptionalText(record.additionalContext)
    };
    const lastMessagePreview = this.buildLastMessagePreview(normalizedEntries);

    this.getDb().run(
      `INSERT INTO conversation_streams
        (id, title, created_at, updated_at, message_count, last_message_preview, additional_context)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         message_count = excluded.message_count,
         last_message_preview = excluded.last_message_preview,
         additional_context = excluded.additional_context`,
      [
        nextRecord.id,
        nextRecord.title,
        nextRecord.createdAt,
        nextRecord.updatedAt,
        nextRecord.entries.length,
        lastMessagePreview ?? null,
        nextRecord.additionalContext ?? null
      ]
    );

    this.getDb().run("DELETE FROM conversation_entries WHERE stream_id = ?", [nextRecord.id]);
    normalizedEntries.forEach((entry, index) => {
      this.getDb().run(
        `INSERT INTO conversation_entries
          (id, stream_id, entry_order, role, text, created_at, kind, based_on_json, mode, request_plan_json, guidance_context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        this.toEntryParams(nextRecord.id, index, entry)
      );
    });

    await this.persist();
    return nextRecord;
  }

  public async deleteStream(id: string): Promise<boolean> {
    const existed = Boolean(this.get(id));
    this.getDb().run("DELETE FROM conversation_entries WHERE stream_id = ?", [id]);
    this.getDb().run("DELETE FROM conversation_streams WHERE id = ?", [id]);
    this.getDb().run("DELETE FROM conversation_metadata WHERE key = ? AND value = ?", [ACTIVE_STREAM_KEY, id]);
    await this.persist();
    return existed;
  }

  public async deleteEmptyStreams(): Promise<void> {
    this.deleteEmptyStreamsInMemory();
    await this.persist();
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
    this.getDb().run(
      `INSERT INTO conversation_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [ACTIVE_STREAM_KEY, id]
    );
    await this.persist();
  }

  public dispose(): void {
    this.db?.close();
    this.db = undefined;
  }

  private migrate(): void {
    this.getDb().run(`
      CREATE TABLE IF NOT EXISTS conversation_streams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT,
        additional_context TEXT
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
        request_plan_json TEXT,
        guidance_context_json TEXT
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

  private selectEntries(streamId: string): StoredConversationEntry[] {
    const stmt = this.getDb().prepare(
      `SELECT id, role, text, created_at, kind, based_on_json, mode, request_plan_json, guidance_context_json
         FROM conversation_entries
        WHERE stream_id = ?
        ORDER BY entry_order ASC`
    );
    const entries: StoredConversationEntry[] = [];

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

  private entryFromRow(row: Record<string, unknown>): StoredConversationEntry {
    return {
      id: String(row.id),
      role: this.parseRole(row.role),
      text: String(row.text),
      createdAt: String(row.created_at),
      kind: this.parseGuidanceKind(row.kind),
      basedOn: this.parseJson<NavigatorContextPreview>(row.based_on_json),
      mode: this.parseMode(row.mode),
      requestPlan: this.parseJson<RequestPlanSnapshot>(row.request_plan_json),
      guidanceContext: this.parseJson<GuidanceContext>(row.guidance_context_json)
    };
  }

  private toEntryParams(streamId: string, index: number, entry: StoredConversationEntry): SqlValue[] {
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
      entry.requestPlan ? JSON.stringify(entry.requestPlan) : null,
      entry.guidanceContext ? JSON.stringify(entry.guidanceContext) : null
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

  private parseGuidanceKind(value: unknown): GuidanceKind {
    switch (value) {
      case "manual":
      case "context":
      case "deep_dive":
      case "always":
        return value;
      default:
        return "manual";
    }
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

  private resolveUpdatedAt(currentUpdatedAt: string, entries: StoredConversationEntry[]): string {
    return entries.at(-1)?.createdAt ?? currentUpdatedAt ?? new Date().toISOString();
  }

  private buildLastMessagePreview(entries: StoredConversationEntry[]): string | undefined {
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

  private async readExistingDatabase(): Promise<Uint8Array | undefined> {
    if (!this.dbUri) {
      return undefined;
    }

    try {
      return await vscode.workspace.fs.readFile(this.dbUri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        return undefined;
      }
      throw error;
    }
  }

  private async persist(): Promise<void> {
    if (!this.dbUri) {
      throw new Error("ConversationStore is not initialized.");
    }

    await vscode.workspace.fs.writeFile(this.dbUri, this.getDb().export());
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("ConversationStore is not initialized.");
    }

    return this.db;
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
