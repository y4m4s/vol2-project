import * as vscode from "vscode";
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
                  advice_text_excerpt = '', reasons_json = ?, comment = ?, summary_text = NULL,
                  summary_status = 'skipped', created_at = ?
            WHERE id = ?`,
          [...values, existingId]
        );
        await this.persist();
        return existingId;
      }

      const id = this.createId();
      this.getDb().run(
        `INSERT INTO advice_feedback
         (id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, advice_text_excerpt, reasons_json, comment, summary_text, summary_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.conversationEntryId,
          input.rating,
          meta.kind,
          meta.assistanceDepth ?? null,
          meta.slashCommand ?? null,
          "",
          reasonsJson,
          comment,
          null,
          "skipped",
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

  public dispose(): void {
    this.db?.close();
    this.db = undefined;
  }

  private migrate(): void {
    this.getDb().run(`
      CREATE TABLE IF NOT EXISTS advice_feedback (
        id TEXT PRIMARY KEY,
        conversation_entry_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
        advice_kind TEXT NOT NULL,
        assistance_depth TEXT,
        slash_command TEXT,
        advice_text_excerpt TEXT NOT NULL,
        reasons_json TEXT,
        comment TEXT,
        summary_text TEXT,
        summary_status TEXT NOT NULL CHECK (summary_status IN ('ok', 'failed', 'skipped')) DEFAULT 'ok',
        created_at TEXT NOT NULL
      );

      DELETE FROM advice_feedback
       WHERE rowid NOT IN (
         SELECT MAX(rowid)
           FROM advice_feedback
          GROUP BY conversation_entry_id
       );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_advice_feedback_entry_unique
        ON advice_feedback(conversation_entry_id);

      DROP INDEX IF EXISTS idx_advice_feedback_entry;
      DROP INDEX IF EXISTS idx_advice_feedback_rating_created;

      CREATE INDEX IF NOT EXISTS idx_advice_feedback_scope_created
        ON advice_feedback(advice_kind, assistance_depth, slash_command, created_at DESC);
    `);
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
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
