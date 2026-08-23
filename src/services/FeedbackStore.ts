import * as vscode from "vscode";
import {
  AdviceFeedbackInput,
  AssistanceDepth,
  FeedbackSummaryResult,
  FeedbackTendencySummary,
  FeedbackRating,
  GuidanceKind,
  SlashCommand
} from "../shared/types";
import { collectValidFeedbackSummaries, validateFeedbackSummary } from "./FeedbackSummaryPolicy";
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
  adviceText: string;
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
    meta: AdviceFeedbackMeta,
    summary: FeedbackSummaryResult
  ): Promise<string> {
    return this.mutationQueue.run(async () => {
      const existingId = this.findFeedbackId(input.conversationEntryId);
      const now = new Date().toISOString();
      const summaryText = summary.status === "ok"
        ? validateFeedbackSummary(summary.summaryText, input.rating)
        : undefined;
      const summaryStatus = summaryText ? "ok" : summary.status === "skipped" ? "skipped" : "failed";
      const values: SqlValue[] = [
        input.rating,
        meta.kind,
        meta.assistanceDepth ?? null,
        meta.slashCommand ?? null,
        this.truncateOneLine(meta.adviceText, 400),
        input.reasons?.length ? JSON.stringify(input.reasons) : null,
        this.normalizeOptionalText(input.comment) ?? null,
        summaryText ?? null,
        summaryStatus,
        now
      ];

      if (existingId) {
        const id = this.createId();
        this.getDb().run(
          `UPDATE advice_feedback
              SET id = ?, rating = ?, advice_kind = ?, assistance_depth = ?, slash_command = ?,
                  advice_text_excerpt = ?, reasons_json = ?, comment = ?, summary_text = ?,
                  summary_status = ?, created_at = ?
            WHERE id = ?`,
          [id, ...values, existingId]
        );
        await this.persist();
        return id;
      }

      const id = this.createId();
      this.getDb().run(
        `INSERT INTO advice_feedback
          (id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, advice_text_excerpt, reasons_json, comment, summary_text, summary_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.conversationEntryId, ...values]
      );
      await this.persist();
      return id;
    });
  }

  public async updateFeedbackSummary(
    id: string,
    rating: FeedbackRating,
    summary: FeedbackSummaryResult
  ): Promise<void> {
    await this.mutationQueue.run(async () => {
      const summaryText = summary.status === "ok"
        ? validateFeedbackSummary(summary.summaryText, rating)
        : undefined;
      this.getDb().run(
        `UPDATE advice_feedback
            SET summary_text = ?, summary_status = ?
          WHERE id = ? AND rating = ?`,
        [
          summaryText ?? null,
          summaryText ? "ok" : summary.status === "skipped" ? "skipped" : "failed",
          id,
          rating
        ]
      );
      await this.persist();
    });
  }

  public getTendencySummary(limit = 5): FeedbackTendencySummary {
    return {
      goodPatterns: this.selectSummaryTexts("good", limit),
      badAvoidPatterns: this.selectSummaryTexts("bad", limit)
    };
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

      CREATE INDEX IF NOT EXISTS idx_advice_feedback_entry
        ON advice_feedback(conversation_entry_id);

      CREATE INDEX IF NOT EXISTS idx_advice_feedback_rating_created
        ON advice_feedback(rating, created_at);

      DELETE FROM advice_feedback
       WHERE rowid NOT IN (
         SELECT MAX(rowid)
           FROM advice_feedback
          GROUP BY conversation_entry_id
       );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_advice_feedback_entry_unique
        ON advice_feedback(conversation_entry_id);
    `);
  }

  private selectSummaryTexts(rating: "good" | "bad", limit: number): string[] {
    if (!Number.isInteger(limit) || limit <= 0) {
      return [];
    }
    const stmt = this.getDb().prepare(
      `SELECT summary_text
         FROM advice_feedback
        WHERE rating = ?
          AND summary_status = 'ok'
          AND summary_text IS NOT NULL
        ORDER BY created_at DESC`
    );
    const candidates: unknown[] = [];

    try {
      stmt.bind([rating]);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        candidates.push(row.summary_text);
      }
    } finally {
      stmt.free();
    }

    return collectValidFeedbackSummaries(candidates, rating, limit);
  }

  private findFeedbackId(conversationEntryId: string): string | undefined {
    const stmt = this.getDb().prepare(
      `SELECT id
         FROM advice_feedback
        WHERE conversation_entry_id = ?
        ORDER BY created_at ASC
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

  private truncateOneLine(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
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
