import * as vscode from "vscode";
import {
  AdviceFeedbackInput,
  AssistanceDepth,
  FeedbackSummaryResult,
  FeedbackTendencySummary,
  GuidanceKind,
  SlashCommand
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

export interface AdviceFeedbackMeta {
  kind: GuidanceKind;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  adviceText: string;
}

export class FeedbackStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "feedback.sqlite");

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    const existingBytes = await this.readExistingDatabase();
    this.db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
    this.migrate();
    await this.persist();
  }

  public async saveFeedback(
    input: AdviceFeedbackInput,
    meta: AdviceFeedbackMeta,
    summary: FeedbackSummaryResult
  ): Promise<void> {
    const now = new Date().toISOString();
    this.getDb().run(
      `INSERT INTO advice_feedback
        (id, conversation_entry_id, rating, advice_kind, assistance_depth, slash_command, advice_text_excerpt, reasons_json, comment, summary_text, summary_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.createId(),
        input.conversationEntryId,
        input.rating,
        meta.kind,
        meta.assistanceDepth ?? null,
        meta.slashCommand ?? null,
        this.truncateOneLine(meta.adviceText, 400),
        input.reasons?.length ? JSON.stringify(input.reasons) : null,
        this.normalizeOptionalText(input.comment) ?? null,
        summary.status === "ok" ? summary.summaryText ?? null : null,
        summary.status,
        now
      ]
    );
    await this.persist();
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
    `);
  }

  private selectSummaryTexts(rating: "good" | "bad", limit: number): string[] {
    const stmt = this.getDb().prepare(
      `SELECT summary_text
         FROM advice_feedback
        WHERE rating = ?
          AND summary_status = 'ok'
          AND summary_text IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?`
    );
    const summaries: string[] = [];

    try {
      stmt.bind([rating, limit]);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.summary_text) {
          summaries.push(String(row.summary_text));
        }
      }
    } finally {
      stmt.free();
    }

    return summaries;
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const normalized = value?.replace(/\r\n/g, "\n").trim();
    return normalized ? normalized : undefined;
  }

  private truncateOneLine(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
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
      throw new Error("FeedbackStore is not initialized.");
    }

    await vscode.workspace.fs.writeFile(this.dbUri, this.getDb().export());
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
