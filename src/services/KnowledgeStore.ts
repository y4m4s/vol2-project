import * as path from "path";
import * as vscode from "vscode";
import { GuidanceContext } from "../shared/types";

type SqlValue = string | number | Uint8Array | null;
type SqlParams = SqlValue[] | Record<string, SqlValue>;
type KnowledgeStatus = "active" | "disabled";

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

export interface KnowledgeRecord {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: KnowledgeStatus;
  sourceAdviceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCreateInput {
  title: string;
  summary: string;
  body: string;
  sourceAdviceId?: string;
}

export interface KnowledgeUpdateInput {
  title: string;
  summary: string;
  body: string;
}

export interface KnowledgeSearchInput {
  query: string;
}

export class KnowledgeStore implements vscode.Disposable {
  private db?: SqlJsDatabase;
  private dbUri?: vscode.Uri;

  public constructor(private readonly storageUri: vscode.Uri) {}

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.dbUri = vscode.Uri.joinPath(this.storageUri, "knowledge.sqlite");

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    const existingBytes = await this.readExistingDatabase();
    this.db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
    this.migrate();
    await this.persist();
  }

  public list(input: KnowledgeSearchInput): KnowledgeRecord[] {
    const normalizedQuery = input.query.trim().toLowerCase();
    const rows = this.selectRecords("SELECT * FROM knowledge ORDER BY updated_at DESC", []);

    if (!normalizedQuery) {
      return rows;
    }

    return rows.filter((item) => {
      const haystack = [
        item.title,
        item.summary,
        item.body
      ].join("\n").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  public get(id: string): KnowledgeRecord | undefined {
    return this.selectRecords("SELECT * FROM knowledge WHERE id = ? LIMIT 1", [id])[0];
  }

  public getBySourceAdviceId(sourceAdviceId: string): KnowledgeRecord | undefined {
    return this.selectRecords(
      "SELECT * FROM knowledge WHERE source_advice_id = ? ORDER BY updated_at DESC LIMIT 1",
      [sourceAdviceId]
    )[0];
  }

  public listSourceAdviceIds(): string[] {
    const sourceAdviceIds = this.selectRecords(
      "SELECT * FROM knowledge WHERE source_advice_id IS NOT NULL ORDER BY updated_at DESC",
      []
    )
      .map((record) => record.sourceAdviceId)
      .filter((sourceAdviceId): sourceAdviceId is string => Boolean(sourceAdviceId));

    return [...new Set(sourceAdviceIds)];
  }

  public async create(input: KnowledgeCreateInput): Promise<KnowledgeRecord> {
    const now = new Date().toISOString();
    const record: KnowledgeRecord = {
      id: this.createId(),
      title: this.normalizeTitle(input.title),
      summary: this.normalizeSummary(input.summary, input.body),
      body: input.body.trim(),
      status: "active",
      sourceAdviceId: input.sourceAdviceId,
      createdAt: now,
      updatedAt: now
    };

    this.getDb().run(
      `INSERT INTO knowledge
        (id, title, summary, body, status, source_advice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      this.toSqlParams(record)
    );
    await this.persist();
    return record;
  }

  public async update(id: string, input: KnowledgeUpdateInput): Promise<KnowledgeRecord | undefined> {
    const existing = this.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: KnowledgeRecord = {
      ...existing,
      title: this.normalizeTitle(input.title),
      summary: this.normalizeSummary(input.summary, input.body),
      body: input.body.trim(),
      status: existing.status,
      updatedAt: new Date().toISOString()
    };

    this.getDb().run(
      `UPDATE knowledge
       SET title = ?, summary = ?, body = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        updated.title,
        updated.summary,
        updated.body,
        updated.status,
        updated.updatedAt,
        id
      ]
    );
    await this.persist();
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    const existing = this.get(id);
    if (!existing) {
      return false;
    }

    this.getDb().run("DELETE FROM knowledge WHERE id = ?", [id]);
    await this.persist();
    return true;
  }

  public findReusable(context: GuidanceContext, limit = 3): KnowledgeRecord[] {
    const records = this.selectRecords("SELECT * FROM knowledge ORDER BY updated_at DESC", []);
    const keywords = this.extractContextKeywords(context);
    if (keywords.length === 0) {
      return records.slice(0, limit);
    }

    return records
      .map((record) => ({
        record,
        score: this.scoreRecord(record, keywords)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, limit)
      .map((item) => item.record);
  }

  public dispose(): void {
    this.db?.close();
    this.db = undefined;
  }

  private migrate(): void {
    this.getDb().run(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        source_advice_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_status_updated
        ON knowledge(status, updated_at);

      CREATE INDEX IF NOT EXISTS idx_knowledge_source_advice
        ON knowledge(source_advice_id);
    `);
  }

  private selectRecords(sql: string, params: SqlValue[]): KnowledgeRecord[] {
    const stmt = this.getDb().prepare(sql);
    const records: KnowledgeRecord[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        records.push(this.fromRow(stmt.getAsObject()));
      }
    } finally {
      stmt.free();
    }

    return records;
  }

  private fromRow(row: Record<string, unknown>): KnowledgeRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      summary: String(row.summary),
      body: String(row.body),
      status: row.status === "disabled" ? "disabled" : "active",
      sourceAdviceId: row.source_advice_id ? String(row.source_advice_id) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private toSqlParams(record: KnowledgeRecord): SqlValue[] {
    return [
      record.id,
      record.title,
      record.summary,
      record.body,
      record.status,
      record.sourceAdviceId ?? null,
      record.createdAt,
      record.updatedAt
    ];
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
      throw new Error("KnowledgeStore is not initialized.");
    }

    await vscode.workspace.fs.writeFile(this.dbUri, this.getDb().export());
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("KnowledgeStore is not initialized.");
    }

    return this.db;
  }

  private normalizeTitle(value: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? this.truncate(normalized, 80) : "無題のナレッジ";
  }

  private normalizeSummary(summary: string, body: string): string {
    const normalized = summary.replace(/\s+/g, " ").trim() || body.replace(/\s+/g, " ").trim();
    return this.truncate(normalized, 180);
  }

  private extractContextKeywords(context: GuidanceContext): string[] {
    const rawValues = [
      context.activeFilePath ? path.basename(context.activeFilePath) : undefined,
      context.activeFileLanguage,
      context.selectedText,
      context.activeFileExcerpt,
      context.additionalContext,
      ...context.relatedSymbols,
      ...context.diagnosticsSummary.map((item) => item.message)
    ];

    const keywords = new Set<string>();
    for (const rawValue of rawValues) {
      if (!rawValue) {
        continue;
      }

      for (const match of rawValue.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{2,}/gu)) {
        keywords.add(match[0].toLowerCase());
        if (keywords.size >= 20) {
          return [...keywords];
        }
      }
    }

    return [...keywords];
  }

  private scoreRecord(record: KnowledgeRecord, keywords: string[]): number {
    const haystack = [
      record.title,
      record.summary,
      record.body
    ].join("\n").toLowerCase();

    return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
