import * as path from "path";
import * as vscode from "vscode";
import { GuidanceContext, KnowledgeStatus } from "../shared/types";

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

export interface KnowledgeRecord {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: KnowledgeStatus;
  tags: string[];
  sourceAdviceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCreateInput {
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  sourceAdviceId?: string;
}

export interface KnowledgeUpdateInput {
  title: string;
  summary: string;
  body: string;
  status: KnowledgeStatus;
  tags: string[];
}

export interface KnowledgeSearchInput {
  query: string;
  status: "all" | KnowledgeStatus;
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
    const rows = this.selectRecords(
      input.status === "all"
        ? "SELECT * FROM knowledge ORDER BY updated_at DESC"
        : "SELECT * FROM knowledge WHERE status = ? ORDER BY updated_at DESC",
      input.status === "all" ? [] : [input.status]
    );

    if (!normalizedQuery) {
      return rows;
    }

    return rows.filter((item) => {
      const haystack = [
        item.title,
        item.summary,
        item.body,
        item.status,
        item.tags.join(" ")
      ].join("\n").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  public get(id: string): KnowledgeRecord | undefined {
    return this.selectRecords("SELECT * FROM knowledge WHERE id = ? LIMIT 1", [id])[0];
  }

  public async create(input: KnowledgeCreateInput): Promise<KnowledgeRecord> {
    const now = new Date().toISOString();
    const record: KnowledgeRecord = {
      id: this.createId(),
      title: this.normalizeTitle(input.title),
      summary: this.normalizeSummary(input.summary, input.body),
      body: input.body.trim(),
      status: "active",
      tags: this.normalizeTags(input.tags ?? []),
      sourceAdviceId: input.sourceAdviceId,
      createdAt: now,
      updatedAt: now
    };

    this.getDb().run(
      `INSERT INTO knowledge
        (id, title, summary, body, status, tags, source_advice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      status: input.status,
      tags: this.normalizeTags(input.tags),
      updatedAt: new Date().toISOString()
    };

    this.getDb().run(
      `UPDATE knowledge
       SET title = ?, summary = ?, body = ?, status = ?, tags = ?, updated_at = ?
       WHERE id = ?`,
      [
        updated.title,
        updated.summary,
        updated.body,
        updated.status,
        JSON.stringify(updated.tags),
        updated.updatedAt,
        id
      ]
    );
    await this.persist();
    return updated;
  }

  public async setStatus(id: string, status: KnowledgeStatus): Promise<KnowledgeRecord | undefined> {
    const existing = this.get(id);
    if (!existing) {
      return undefined;
    }

    const updatedAt = new Date().toISOString();
    this.getDb().run("UPDATE knowledge SET status = ?, updated_at = ? WHERE id = ?", [status, updatedAt, id]);
    await this.persist();
    return this.get(id);
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

  public async reset(): Promise<void> {
    this.getDb().run("DELETE FROM knowledge");
    await this.persist();
  }

  public exportRecords(): KnowledgeRecord[] {
    return this.selectRecords("SELECT * FROM knowledge ORDER BY updated_at DESC", []);
  }

  public async exportToFiles(): Promise<{ count: number; jsonPath: string; markdownPath: string }> {
    const records = this.exportRecords();
    const exportDir = vscode.Uri.joinPath(this.storageUri, "exports");
    await vscode.workspace.fs.createDirectory(exportDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonUri = vscode.Uri.joinPath(exportDir, `knowledge-${timestamp}.json`);
    const markdownUri = vscode.Uri.joinPath(exportDir, `knowledge-${timestamp}.md`);

    await vscode.workspace.fs.writeFile(
      jsonUri,
      Buffer.from(JSON.stringify(records, null, 2), "utf8")
    );
    await vscode.workspace.fs.writeFile(
      markdownUri,
      Buffer.from(this.toMarkdown(records), "utf8")
    );

    return {
      count: records.length,
      jsonPath: jsonUri.fsPath,
      markdownPath: markdownUri.fsPath
    };
  }

  public findReusable(context: GuidanceContext, limit = 3): KnowledgeRecord[] {
    const activeRecords = this.selectRecords("SELECT * FROM knowledge WHERE status = ? ORDER BY updated_at DESC", ["active"]);
    const keywords = this.extractContextKeywords(context);
    if (keywords.length === 0) {
      return activeRecords.slice(0, limit);
    }

    return activeRecords
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
        tags TEXT NOT NULL DEFAULT '[]',
        source_advice_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_status_updated
        ON knowledge(status, updated_at);
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
      tags: this.parseTags(row.tags),
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
      JSON.stringify(record.tags),
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

  private normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].slice(0, 12);
  }

  private parseTags(value: unknown): string[] {
    if (typeof value !== "string" || value.length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private extractContextKeywords(context: GuidanceContext): string[] {
    const rawValues = [
      context.activeFilePath ? path.basename(context.activeFilePath) : undefined,
      context.activeFileLanguage,
      context.selectedText,
      context.activeFileExcerpt,
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
      record.body,
      record.tags.join(" ")
    ].join("\n").toLowerCase();

    return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private toMarkdown(records: KnowledgeRecord[]): string {
    const lines = ["# NaviCom Knowledge", ""];

    if (records.length === 0) {
      lines.push("_No knowledge entries._", "");
      return lines.join("\n");
    }

    for (const record of records) {
      lines.push(`## ${record.title}`, "");
      lines.push(`- Status: ${record.status}`);
      lines.push(`- Updated: ${record.updatedAt}`);
      if (record.tags.length > 0) {
        lines.push(`- Tags: ${record.tags.join(", ")}`);
      }
      if (record.sourceAdviceId) {
        lines.push(`- Source Advice: ${record.sourceAdviceId}`);
      }
      lines.push("", record.summary, "", record.body, "");
    }

    return lines.join("\n");
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
