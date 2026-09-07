import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  AdviceFeedbackInput,
  AssistanceDepth,
  FeedbackTendencySummary,
  GuidanceKind,
  SlashCommand
} from "../shared/types";
import { collectFeedbackTendency, type FeedbackTendencyCandidate } from "../shared/feedback";
import { SerialTaskQueue } from "./SerialTaskQueue";
import { openDatabaseWithBackup, writeFileAtomically } from "./AtomicFileStorage";

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

const FEEDBACK_SCHEMA_VERSION = 2;

export interface AdviceFeedbackMeta {
  kind: GuidanceKind;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
}

export interface FeedbackTendencyScope {
  kind: GuidanceKind;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
}

export class FeedbackStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;
  private readonly mutationQueue = new SerialTaskQueue();

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "feedback.sqlite");

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    this.db = await openDatabaseWithBackup(this.dbUri, SQL.Database);
    this.migrate();
    await this.persist();
  }

  public async saveFeedback(
    input: AdviceFeedbackInput,
    meta: AdviceFeedbackMeta
  ): Promise<string> {
    return this.mutationQueue.run(async () => {
      const existingId = this.findFeedbackId(input.conversationEntryId);
      const now = new Date().toISOString();
      const reasonsJson = JSON.stringify(input.reasons);
      const comment = this.normalizeOptionalText(input.comment) ?? null;
      const values: SqlValue[] = [
        input.rating,
        meta.kind,
        meta.assistanceDepth ?? null,
        meta.slashCommand ?? null,
        reasonsJson,
        comment,
        now
      ];

      if (existingId) {
        this.getDb().run(
          `UPDATE advice_feedback
              SET rating = ?, advice_kind = ?, assistance_depth = ?, slash_command = ?,
                  reasons_json = ?, comment = ?, created_at = ?
            WHERE id = ?`,
          [...values, existingId]
        );
        await this.persist();
        return existingId;
      }

      const id = this.createId();
      this.getDb().run(
        `INSERT INTO advice_feedback
         (id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, reasons_json, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.conversationEntryId,
          input.rating,
          meta.kind,
          meta.assistanceDepth ?? null,
          meta.slashCommand ?? null,
          reasonsJson,
          comment,
          now
        ]
      );
      await this.persist();
      return id;
    });
  }

  public getTendencySummary(scope: FeedbackTendencyScope, limit = 5): FeedbackTendencySummary {
    return collectFeedbackTendency(this.selectTendencyCandidates(scope), limit);
  }

  public listConversationEntryIds(): string[] {
    const stmt = this.getDb().prepare("SELECT conversation_entry_id FROM advice_feedback");
    const ids: string[] = [];
    try {
      while (stmt.step()) {
        const value = stmt.getAsObject().conversation_entry_id;
        if (typeof value === "string" && value.length > 0) ids.push(value);
      }
      return ids;
    } finally {
      stmt.free();
    }
  }

  public async deleteByConversationEntryIds(conversationEntryIds: readonly string[]): Promise<void> {
    const ids = [...new Set(conversationEntryIds.filter((id) => id.trim().length > 0))];
    if (ids.length === 0) return;

    await this.mutationQueue.run(async () => {
      for (let index = 0; index < ids.length; index += 200) {
        const chunk = ids.slice(index, index + 200);
        this.getDb().run(
          `DELETE FROM advice_feedback WHERE conversation_entry_id IN (${chunk.map(() => "?").join(", ")})`,
          chunk
        );
      }
      await this.persist();
    });
  }

  public async deleteAll(): Promise<void> {
    await this.mutationQueue.run(async () => {
      this.getDb().run("DELETE FROM advice_feedback");
      await this.persist();
    });
  }

  public dispose(): void {
    this.db?.close();
    this.db = undefined;
  }

  private migrate(): void {
    const db = this.getDb();
    const version = this.getUserVersion();
    if (version > FEEDBACK_SCHEMA_VERSION) {
      throw new Error(`Unsupported feedback database schema version: ${version}`);
    }

    if (!this.tableExists("advice_feedback")) {
      db.run(`
        CREATE TABLE advice_feedback (
          id TEXT PRIMARY KEY,
          conversation_entry_id TEXT NOT NULL UNIQUE,
          rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
          advice_kind TEXT NOT NULL,
          assistance_depth TEXT,
          slash_command TEXT,
          reasons_json TEXT,
          comment TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_advice_feedback_scope_created
          ON advice_feedback(advice_kind, assistance_depth, slash_command, created_at DESC);

        PRAGMA user_version = ${FEEDBACK_SCHEMA_VERSION};
      `);
      return;
    }

    if (version < FEEDBACK_SCHEMA_VERSION || this.hasColumn("advice_feedback", "advice_text_excerpt")) {
      this.migrateToVersion2();
      return;
    }

    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advice_feedback_entry_unique
        ON advice_feedback(conversation_entry_id);

      CREATE INDEX IF NOT EXISTS idx_advice_feedback_scope_created
        ON advice_feedback(advice_kind, assistance_depth, slash_command, created_at DESC);
    `);
  }

  private migrateToVersion2(): void {
    const db = this.getDb();
    db.run("BEGIN IMMEDIATE");
    try {
      db.run(`
        CREATE TABLE advice_feedback_v2 (
          id TEXT PRIMARY KEY,
          conversation_entry_id TEXT NOT NULL UNIQUE,
          rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
          advice_kind TEXT NOT NULL,
          assistance_depth TEXT,
          slash_command TEXT,
          reasons_json TEXT,
          comment TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO advice_feedback_v2
          (id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, reasons_json, comment, created_at)
        SELECT id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, reasons_json, comment, created_at
          FROM advice_feedback
         WHERE rowid IN (
           SELECT MAX(rowid)
             FROM advice_feedback
            GROUP BY conversation_entry_id
         );

        DROP TABLE advice_feedback;
        ALTER TABLE advice_feedback_v2 RENAME TO advice_feedback;

        CREATE INDEX idx_advice_feedback_scope_created
          ON advice_feedback(advice_kind, assistance_depth, slash_command, created_at DESC);

        PRAGMA user_version = ${FEEDBACK_SCHEMA_VERSION};
      `);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
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

  private tableExists(tableName: string): boolean {
    const stmt = this.getDb().prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    );
    try {
      stmt.bind([tableName]);
      return stmt.step();
    } finally {
      stmt.free();
    }
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const stmt = this.getDb().prepare(`PRAGMA table_info(${tableName})`);
    try {
      while (stmt.step()) {
        if (String(stmt.getAsObject().name) === columnName) return true;
      }
      return false;
    } finally {
      stmt.free();
    }
  }

  private selectTendencyCandidates(scope: FeedbackTendencyScope): FeedbackTendencyCandidate[] {
    const stmt = this.getDb().prepare(
      `SELECT rating, reasons_json
         FROM advice_feedback
        WHERE advice_kind = ?
          AND ((assistance_depth = ?) OR (assistance_depth IS NULL AND ? IS NULL))
          AND ((slash_command = ?) OR (slash_command IS NULL AND ? IS NULL))
        ORDER BY created_at DESC
        LIMIT 100`
    );
    const candidates: FeedbackTendencyCandidate[] = [];
    const assistanceDepth = scope.assistanceDepth ?? null;
    const slashCommand = scope.slashCommand ?? null;

    try {
      stmt.bind([scope.kind, assistanceDepth, assistanceDepth, slashCommand, slashCommand]);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.rating !== "good" && row.rating !== "bad") continue;
        candidates.push({
          rating: row.rating,
          reasons: this.parseReasons(row.reasons_json)
        });
      }
    } finally {
      stmt.free();
    }

    return candidates;
  }

  private parseReasons(value: unknown): unknown[] {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private findFeedbackId(conversationEntryId: string): string | undefined {
    const stmt = this.getDb().prepare(
      `SELECT id
         FROM advice_feedback
        WHERE conversation_entry_id = ?
        LIMIT 1`
    );

    try {
      stmt.bind([conversationEntryId]);
      return stmt.step() ? String(stmt.getAsObject().id) : undefined;
    } finally {
      stmt.free();
    }
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const normalized = value?.replace(/\r\n/g, "\n").trim();
    return normalized ? normalized : undefined;
  }

  private async persist(): Promise<void> {
    if (!this.dbUri) {
      throw new Error("FeedbackStore is not initialized.");
    }

    await writeFileAtomically(this.dbUri, this.getDb().export());
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("FeedbackStore is not initialized.");
    }

    return this.db;
  }

  private createId(): string {
    return randomUUID();
  }
}
