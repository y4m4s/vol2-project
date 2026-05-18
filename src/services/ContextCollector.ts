import * as vscode from "vscode";
import * as path from "path";
import {
  DiagnosticSeverityLabel,
  DiagnosticSummary,
  GuidanceContext,
  NavigatorSettings,
  ProjectContextScope,
  ReferencedFileContext,
  ReferencedFileReason,
  NavigatorContextPreview
} from "../shared/types";

const MAX_PREVIEW_TEXT_LENGTH = 240;
const MAX_SELECTED_TEXT_LENGTH = 4000;
const MAX_ACTIVE_FILE_EXCERPT_LENGTH = 8000;
const MAX_DIAGNOSTIC_COUNT = 5;
const FALLBACK_TOP_LINE_COUNT = 80;
const MAX_RECENT_EDIT_COUNT = 5;
const MAX_RECENT_EDIT_PREVIEW_LENGTH = 100;
const RECENT_EDIT_TTL_MS = 5 * 60 * 1000;
const MAX_WORKSPACE_TREE_FILES = 160;
const MAX_WORKSPACE_TREE_TEXT_LENGTH = 5000;
const MAX_REFERENCED_FILE_COUNT = 5;
const MAX_REFERENCED_FILE_EXCERPT_LENGTH = 3000;
const MAX_REFERENCED_FILE_BYTES = 200_000;
const SAME_DIRECTORY_FILE_LIMIT = 10;
const NEXT_TODO_FILE_LIMIT = 180;
const NEXT_TODO_MAX_FILE_BYTES = 200_000;
const NEXT_MANIFEST_MAX_FILE_BYTES = 200_000;
const NEXT_DOC_MAX_FILE_BYTES = 200_000;

interface RecentEditRecord {
  lineStart: number;
  lineEnd: number;
  preview: string;
  timestamp: number;
}

interface ReferencedFileCandidate {
  uri: vscode.Uri;
  reason: ReferencedFileReason;
  score: number;
}

interface WorkspaceTreeNode {
  children: Map<string, WorkspaceTreeNode>;
  file: boolean;
}

interface NextContextLimits {
  workspaceTreeFiles: number;
  workspaceTreeTextLength: number;
  referencedFileCount: number;
  referencedFileExcerptLength: number;
  diagnosticsCount: number;
  recentEditCount: number;
  openFileCount: number;
  todoCount: number;
  docsCount: number;
}

const NEXT_CONTEXT_LIMITS: Record<ProjectContextScope, NextContextLimits> = {
  "project-lite": {
    workspaceTreeFiles: 120,
    workspaceTreeTextLength: 3600,
    referencedFileCount: 2,
    referencedFileExcerptLength: 1400,
    diagnosticsCount: 8,
    recentEditCount: 8,
    openFileCount: 8,
    todoCount: 8,
    docsCount: 4
  },
  project: {
    workspaceTreeFiles: 180,
    workspaceTreeTextLength: 5200,
    referencedFileCount: 3,
    referencedFileExcerptLength: 2200,
    diagnosticsCount: 12,
    recentEditCount: 12,
    openFileCount: 12,
    todoCount: 12,
    docsCount: 6
  },
  deep: {
    workspaceTreeFiles: 260,
    workspaceTreeTextLength: 7600,
    referencedFileCount: 5,
    referencedFileExcerptLength: 3200,
    diagnosticsCount: 18,
    recentEditCount: 18,
    openFileCount: 16,
    todoCount: 18,
    docsCount: 9
  }
};

export class ContextCollector {
  private readonly recentEditsByDocument = new Map<string, RecentEditRecord[]>();
  private readonly documentSnapshotsByUri = new Map<string, string>();

  public primeDocuments(documents: readonly vscode.TextDocument[]): void {
    for (const document of documents) {
      this.primeDocument(document);
    }
  }

  public primeDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file") {
      return;
    }

    this.documentSnapshotsByUri.set(document.uri.toString(), document.getText());
  }

  public releaseDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.documentSnapshotsByUri.delete(key);
    this.recentEditsByDocument.delete(key);
  }

  public collectPreview(): NavigatorContextPreview {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return {
        diagnosticsSummary: []
      };
    }

    const selectedText = this.getSelectedText(editor);

    return {
      activeFilePath: editor.document.uri.fsPath,
      selectedTextPreview: this.toPreviewText(selectedText),
      diagnosticsSummary: this.collectDiagnostics(editor.document.uri)
    };
  }

  public collectGuidanceContext(): GuidanceContext {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return {
        referencedFiles: [],
        diagnosticsSummary: [],
        recentEditsSummary: [],
        relatedSymbols: []
      };
    }

    const selectedText = this.getSelectedText(editor);

    return {
      activeFilePath: editor.document.uri.fsPath,
      activeFileLanguage: editor.document.languageId,
      activeFileExcerpt: this.collectActiveFileExcerpt(editor, selectedText),
      selectedText: this.limitText(selectedText, MAX_SELECTED_TEXT_LENGTH),
      referencedFiles: [],
      diagnosticsSummary: this.collectDiagnostics(editor.document.uri),
      recentEditsSummary: this.collectRecentEdits(editor.document.uri),
      relatedSymbols: this.collectRelatedSymbols(editor, selectedText)
    };
  }

  public async collectGuidanceContextWithWorkspace(
    settings: NavigatorSettings,
    baseContext?: GuidanceContext
  ): Promise<GuidanceContext> {
    const context = baseContext ?? this.collectGuidanceContext();
    if (!settings.enableWorkspaceContext) {
      return context;
    }

    const excludedGlobs = this.getEffectiveExcludedGlobs(settings);
    const [workspaceTree, referencedFiles] = await Promise.all([
      this.collectWorkspaceTree(excludedGlobs),
      this.collectReferencedFiles(context, excludedGlobs)
    ]);

    return {
      ...context,
      workspaceTree,
      referencedFiles
    };
  }

  public async collectNextActionContext(
    settings: NavigatorSettings,
    scope: ProjectContextScope,
    baseContext?: GuidanceContext
  ): Promise<GuidanceContext> {
    const context = baseContext ?? this.collectGuidanceContext();
    const excludedGlobs = this.getEffectiveExcludedGlobs(settings);
    const limits = NEXT_CONTEXT_LIMITS[scope];
    const [
      workspaceTree,
      referencedFiles,
      openFiles,
      diagnosticsSummary,
      recentEditsSummary,
      todoSummary,
      manifestSummary,
      docsSummary
    ] = await Promise.all([
      this.collectWorkspaceTree(excludedGlobs, limits.workspaceTreeFiles, limits.workspaceTreeTextLength),
      this.collectReferencedFiles(context, excludedGlobs, limits.referencedFileCount, limits.referencedFileExcerptLength),
      Promise.resolve(this.collectOpenFileSummary(excludedGlobs, limits.openFileCount)),
      Promise.resolve(this.collectWorkspaceDiagnosticsSummary(excludedGlobs, limits.diagnosticsCount)),
      Promise.resolve(this.collectWorkspaceRecentEditsSummary(excludedGlobs, limits.recentEditCount)),
      this.collectTodoSummary(excludedGlobs, limits.todoCount),
      this.collectManifestSummary(excludedGlobs),
      this.collectDocsSummary(excludedGlobs, limits.docsCount)
    ]);

    return {
      ...context,
      workspaceTree,
      referencedFiles,
      projectSummary: {
        scope,
        openFiles,
        diagnosticsSummary,
        recentEditsSummary,
        todoSummary,
        manifestSummary,
        docsSummary
      }
    };
  }

  public captureDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0 || event.document.uri.scheme !== "file") {
      return;
    }

    const key = event.document.uri.toString();
    const previousText = this.documentSnapshotsByUri.get(key);
    const existing = this.pruneRecentEdits(this.recentEditsByDocument.get(key) ?? []);
    const changes = event.contentChanges
      .slice(0, MAX_RECENT_EDIT_COUNT)
      .map((change) => this.toRecentEditRecord(change, previousText));
    const nextRecords = [...changes, ...existing].slice(0, MAX_RECENT_EDIT_COUNT);

    this.recentEditsByDocument.set(key, nextRecords);
    this.documentSnapshotsByUri.set(key, event.document.getText());
  }

  private getSelectedText(editor: vscode.TextEditor): string | undefined {
    if (editor.selection.isEmpty) {
      return undefined;
    }

    const text = editor.document.getText(editor.selection);
    return text.trim().length > 0 ? text : undefined;
  }

  private collectDiagnostics(uri: vscode.Uri): DiagnosticSummary[] {
    return vscode.languages.getDiagnostics(uri).slice(0, MAX_DIAGNOSTIC_COUNT).map((diagnostic) => ({
      severity: this.mapSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      line: diagnostic.range.start.line + 1
    }));
  }

  private collectActiveFileExcerpt(editor: vscode.TextEditor, selectedText?: string): string | undefined {
    if (selectedText) {
      return this.limitText(selectedText, MAX_ACTIVE_FILE_EXCERPT_LENGTH);
    }

    const visibleRange = editor.visibleRanges[0];
    if (visibleRange) {
      const visibleText = editor.document.getText(visibleRange);
      if (visibleText.trim().length > 0) {
        return this.limitText(visibleText, MAX_ACTIVE_FILE_EXCERPT_LENGTH);
      }
    }

    const lastLine = Math.min(editor.document.lineCount - 1, FALLBACK_TOP_LINE_COUNT - 1);
    if (lastLine < 0) {
      return undefined;
    }

    const fallbackRange = new vscode.Range(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
    const fallbackText = editor.document.getText(fallbackRange);

    return fallbackText.trim().length > 0
      ? this.limitText(fallbackText, MAX_ACTIVE_FILE_EXCERPT_LENGTH)
      : undefined;
  }

  private toPreviewText(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    return this.limitText(normalized, MAX_PREVIEW_TEXT_LENGTH);
  }

  private limitText(value: string | undefined, maxLength: number): string | undefined {
    if (!value) {
      return undefined;
    }

    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticSeverityLabel {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return "Error";
      case vscode.DiagnosticSeverity.Warning:
        return "Warning";
      case vscode.DiagnosticSeverity.Information:
        return "Information";
      case vscode.DiagnosticSeverity.Hint:
      default:
        return "Hint";
    }
  }

  private collectRecentEdits(uri: vscode.Uri): string[] {
    const key = uri.toString();
    const records = this.pruneRecentEdits(this.recentEditsByDocument.get(key) ?? []);

    if (records.length === 0) {
      return [];
    }

    this.recentEditsByDocument.set(key, records);

    return records.map((record) => {
      const lineLabel = record.lineStart === record.lineEnd ? `L${record.lineStart}` : `L${record.lineStart}-L${record.lineEnd}`;
      return `${lineLabel}: ${record.preview}`;
    });
  }

  private async collectWorkspaceTree(
    excludedGlobs: string[],
    maxFiles = MAX_WORKSPACE_TREE_FILES,
    maxTextLength = MAX_WORKSPACE_TREE_TEXT_LENGTH
  ): Promise<GuidanceContext["workspaceTree"]> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return undefined;
    }

    const excludePattern = this.toFindFilesExcludePattern(excludedGlobs);
    const uris = await vscode.workspace.findFiles("**/*", excludePattern, maxFiles + 1);
    const relativePaths = uris
      .filter((uri) => uri.scheme === "file" && !this.isPathExcluded(uri.fsPath, excludedGlobs))
      .slice(0, maxFiles)
      .map((uri) => this.toWorkspaceRelativePath(uri))
      .sort((a, b) => a.localeCompare(b));

    if (relativePaths.length === 0) {
      return undefined;
    }

    const rawTreeText = this.buildTreeText(relativePaths);
    const treeText = this.limitText(rawTreeText, maxTextLength) ?? rawTreeText;

    return {
      rootPath: vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath).join("; "),
      treeText,
      truncated: uris.length > maxFiles || treeText.length < rawTreeText.length
    };
  }

  private async collectReferencedFiles(
    context: GuidanceContext,
    excludedGlobs: string[],
    maxCount = MAX_REFERENCED_FILE_COUNT,
    maxExcerptLength = MAX_REFERENCED_FILE_EXCERPT_LENGTH
  ): Promise<ReferencedFileContext[]> {
    const candidates = new Map<string, ReferencedFileCandidate>();
    const activePath = context.activeFilePath;

    for (const document of vscode.workspace.textDocuments) {
      this.addReferencedFileCandidate(candidates, document.uri, "open", 60, activePath, excludedGlobs);
    }

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (diagnostics.length === 0) {
        continue;
      }
      const score = diagnostics.some((item) => item.severity === vscode.DiagnosticSeverity.Error) ? 90 : 75;
      this.addReferencedFileCandidate(candidates, uri, "diagnostic", score, activePath, excludedGlobs);
    }

    for (const key of this.recentEditsByDocument.keys()) {
      this.addReferencedFileCandidate(
        candidates,
        vscode.Uri.parse(key),
        "recentEdit",
        85,
        activePath,
        excludedGlobs
      );
    }

    for (const uri of await this.collectSameDirectoryUris(activePath, excludedGlobs)) {
      this.addReferencedFileCandidate(candidates, uri, "sameDirectory", 45, activePath, excludedGlobs);
    }

    const selected = [...candidates.values()]
      .sort((a, b) => b.score - a.score || a.uri.fsPath.localeCompare(b.uri.fsPath))
      .slice(0, maxCount);
    const contexts = await Promise.all(selected.map((candidate) => this.toReferencedFileContext(candidate, maxExcerptLength)));

    return contexts.filter((item): item is ReferencedFileContext => Boolean(item));
  }

  private async collectSameDirectoryUris(
    activeFilePath: string | undefined,
    excludedGlobs: string[]
  ): Promise<vscode.Uri[]> {
    if (!activeFilePath) {
      return [];
    }

    const activeUri = vscode.Uri.file(activeFilePath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (!workspaceFolder) {
      return [];
    }

    const relativePath = vscode.workspace.asRelativePath(activeUri, false).replaceAll("\\", "/");
    const relativeDir = path.posix.dirname(relativePath);
    const pattern = new vscode.RelativePattern(
      workspaceFolder,
      relativeDir === "." ? "*" : `${relativeDir}/*`
    );

    return vscode.workspace.findFiles(
      pattern,
      this.toFindFilesExcludePattern(excludedGlobs),
      SAME_DIRECTORY_FILE_LIMIT
    );
  }

  private addReferencedFileCandidate(
    candidates: Map<string, ReferencedFileCandidate>,
    uri: vscode.Uri,
    reason: ReferencedFileReason,
    score: number,
    activeFilePath: string | undefined,
    excludedGlobs: string[]
  ): void {
    if (
      uri.scheme !== "file" ||
      uri.fsPath === activeFilePath ||
      this.isPathExcluded(uri.fsPath, excludedGlobs)
    ) {
      return;
    }

    const key = uri.toString();
    const existing = candidates.get(key);
    if (!existing || existing.score < score) {
      candidates.set(key, { uri, reason, score });
    }
  }

  private async toReferencedFileContext(
    candidate: ReferencedFileCandidate,
    maxExcerptLength = MAX_REFERENCED_FILE_EXCERPT_LENGTH
  ): Promise<ReferencedFileContext | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(candidate.uri);
      if (stat.type !== vscode.FileType.File || stat.size > MAX_REFERENCED_FILE_BYTES) {
        return undefined;
      }

      const document = await vscode.workspace.openTextDocument(candidate.uri);
      const excerpt = this.collectDocumentExcerpt(document, maxExcerptLength);
      if (!excerpt && this.collectDiagnostics(candidate.uri).length === 0) {
        return undefined;
      }

      return {
        path: candidate.uri.fsPath,
        languageId: document.languageId,
        reason: candidate.reason,
        excerpt,
        diagnosticsSummary: this.collectDiagnostics(candidate.uri),
        recentEditsSummary: this.collectRecentEdits(candidate.uri),
        score: candidate.score
      };
    } catch {
      return undefined;
    }
  }

  private collectDocumentExcerpt(document: vscode.TextDocument, maxLength: number): string | undefined {
    const lastLine = Math.min(document.lineCount - 1, FALLBACK_TOP_LINE_COUNT - 1);
    if (lastLine < 0) {
      return undefined;
    }

    const range = new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
    const text = document.getText(range);

    return text.trim().length > 0 ? this.limitText(text, maxLength) : undefined;
  }

  private buildTreeText(relativePaths: string[]): string {
    const root = this.createTreeNode();
    for (const relativePath of relativePaths) {
      const parts = relativePath.split("/").filter(Boolean);
      let node = root;
      parts.forEach((part, index) => {
        let child = node.children.get(part);
        if (!child) {
          child = this.createTreeNode();
          node.children.set(part, child);
        }
        if (index === parts.length - 1) {
          child.file = true;
        }
        node = child;
      });
    }

    return this.renderTreeNode(root, 0).join("\n");
  }

  private createTreeNode(): WorkspaceTreeNode {
    return {
      children: new Map<string, WorkspaceTreeNode>(),
      file: false
    };
  }

  private renderTreeNode(node: WorkspaceTreeNode, depth: number): string[] {
    const lines: string[] = [];
    const entries = [...node.children.entries()].sort((a, b) =>
      Number(a[1].file) - Number(b[1].file) || a[0].localeCompare(b[0])
    );

    for (const [name, child] of entries) {
      lines.push(`${"  ".repeat(depth)}${name}${child.file ? "" : "/"}`);
      lines.push(...this.renderTreeNode(child, depth + 1));
    }

    return lines;
  }

  private toWorkspaceRelativePath(uri: vscode.Uri): string {
    const includeWorkspaceFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    return vscode.workspace.asRelativePath(uri, includeWorkspaceFolder).replaceAll("\\", "/");
  }

  private toFindFilesExcludePattern(patterns: string[]): string | undefined {
    return patterns.length > 0 ? `{${patterns.join(",")}}` : undefined;
  }

  private collectOpenFileSummary(excludedGlobs: string[], maxCount: number): string[] {
    return vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === "file" && !this.isPathExcluded(document.uri.fsPath, excludedGlobs))
      .map((document) => `${this.toWorkspaceRelativePath(document.uri)} (${document.languageId})`)
      .slice(0, maxCount);
  }

  private collectWorkspaceDiagnosticsSummary(excludedGlobs: string[], maxCount: number): string[] {
    return vscode.languages.getDiagnostics()
      .flatMap(([uri, diagnostics]) => diagnostics
        .filter(() => uri.scheme === "file" && !this.isPathExcluded(uri.fsPath, excludedGlobs))
        .map((diagnostic) => ({
          uri,
          diagnostic
        })))
      .sort((a, b) => a.diagnostic.severity - b.diagnostic.severity)
      .slice(0, maxCount)
      .map(({ uri, diagnostic }) => {
        const source = diagnostic.source ? ` (${diagnostic.source})` : "";
        return `${this.toWorkspaceRelativePath(uri)} L${diagnostic.range.start.line + 1}: ${this.mapSeverity(diagnostic.severity)}${source}: ${this.normalizeOneLine(diagnostic.message, 160)}`;
      });
  }

  private collectWorkspaceRecentEditsSummary(excludedGlobs: string[], maxCount: number): string[] {
    const summaries: Array<{ timestamp: number; text: string }> = [];

    for (const [key, records] of this.recentEditsByDocument.entries()) {
      const uri = vscode.Uri.parse(key);
      if (uri.scheme !== "file" || this.isPathExcluded(uri.fsPath, excludedGlobs)) {
        continue;
      }

      const pruned = this.pruneRecentEdits(records);
      this.recentEditsByDocument.set(key, pruned);
      for (const record of pruned) {
        const lineLabel = record.lineStart === record.lineEnd ? `L${record.lineStart}` : `L${record.lineStart}-L${record.lineEnd}`;
        summaries.push({
          timestamp: record.timestamp,
          text: `${this.toWorkspaceRelativePath(uri)} ${lineLabel}: ${record.preview}`
        });
      }
    }

    return summaries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxCount)
      .map((item) => item.text);
  }

  private async collectTodoSummary(excludedGlobs: string[], maxCount: number): Promise<string[]> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return [];
    }

    const uris = await vscode.workspace.findFiles(
      "**/*",
      this.toFindFilesExcludePattern(excludedGlobs),
      NEXT_TODO_FILE_LIMIT
    );
    const summaries: string[] = [];

    for (const uri of uris) {
      if (
        summaries.length >= maxCount ||
        uri.scheme !== "file" ||
        this.isPathExcluded(uri.fsPath, excludedGlobs) ||
        !this.isLikelyTextPath(uri.fsPath)
      ) {
        continue;
      }

      const text = await this.readSmallTextFile(uri, NEXT_TODO_MAX_FILE_BYTES);
      if (!text) {
        continue;
      }

      const lines = text.replace(/\r\n/g, "\n").split("\n");
      for (let index = 0; index < lines.length && summaries.length < maxCount; index += 1) {
        if (/\b(TODO|FIXME|XXX)\b/i.test(lines[index])) {
          summaries.push(`${this.toWorkspaceRelativePath(uri)} L${index + 1}: ${this.normalizeOneLine(lines[index], 180)}`);
        }
      }
    }

    return summaries;
  }

  private async collectManifestSummary(excludedGlobs: string[]): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const summaries: string[] = [];

    for (const folder of workspaceFolders) {
      const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");
      if (!this.isPathExcluded(packageJsonUri.fsPath, excludedGlobs)) {
        const packageSummary = await this.summarizePackageJson(packageJsonUri);
        if (packageSummary) {
          summaries.push(packageSummary);
        }
      }

      for (const fileName of ["tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"]) {
        const uri = vscode.Uri.joinPath(folder.uri, fileName);
        if (this.isPathExcluded(uri.fsPath, excludedGlobs)) {
          continue;
        }
        const text = await this.readSmallTextFile(uri, NEXT_MANIFEST_MAX_FILE_BYTES);
        if (text) {
          summaries.push(`${this.toWorkspaceRelativePath(uri)}: ${this.normalizeOneLine(text, 220)}`);
        }
      }
    }

    return summaries.slice(0, 6);
  }

  private async collectDocsSummary(excludedGlobs: string[], maxCount: number): Promise<string[]> {
    const excludePattern = this.toFindFilesExcludePattern(excludedGlobs);
    const uriGroups = await Promise.all([
      vscode.workspace.findFiles("**/README.md", excludePattern, 4),
      vscode.workspace.findFiles("**/readme.md", excludePattern, 4),
      vscode.workspace.findFiles("docs/**/*.md", excludePattern, maxCount)
    ]);
    const seen = new Set<string>();
    const summaries: string[] = [];

    for (const uri of uriGroups.flat()) {
      if (
        summaries.length >= maxCount ||
        uri.scheme !== "file" ||
        this.isPathExcluded(uri.fsPath, excludedGlobs) ||
        seen.has(uri.toString())
      ) {
        continue;
      }

      seen.add(uri.toString());
      const text = await this.readSmallTextFile(uri, NEXT_DOC_MAX_FILE_BYTES);
      if (text) {
        summaries.push(`${this.toWorkspaceRelativePath(uri)}: ${this.summarizeMarkdownText(text)}`);
      }
    }

    return summaries;
  }

  private async summarizePackageJson(uri: vscode.Uri): Promise<string | undefined> {
    const text = await this.readSmallTextFile(uri, NEXT_MANIFEST_MAX_FILE_BYTES);
    if (!text) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const scripts = parsed.scripts && typeof parsed.scripts === "object"
        ? Object.keys(parsed.scripts).slice(0, 8).join(", ")
        : "";
      const dependencies = parsed.dependencies && typeof parsed.dependencies === "object"
        ? Object.keys(parsed.dependencies).slice(0, 8).join(", ")
        : "";
      const devDependencies = parsed.devDependencies && typeof parsed.devDependencies === "object"
        ? Object.keys(parsed.devDependencies).slice(0, 8).join(", ")
        : "";
      return [
        `${this.toWorkspaceRelativePath(uri)}:`,
        parsed.name ? `name=${String(parsed.name)}` : undefined,
        scripts ? `scripts=${scripts}` : undefined,
        dependencies ? `deps=${dependencies}` : undefined,
        devDependencies ? `devDeps=${devDependencies}` : undefined
      ].filter((value): value is string => Boolean(value)).join(" ");
    } catch {
      return `${this.toWorkspaceRelativePath(uri)}: ${this.normalizeOneLine(text, 220)}`;
    }
  }

  private summarizeMarkdownText(text: string): string {
    const normalizedLines = text.replace(/\r\n/g, "\n").split("\n");
    const headingLines = normalizedLines
      .map((line) => line.trim())
      .filter((line) => /^#{1,3}\s+/.test(line))
      .slice(0, 6)
      .map((line) => line.replace(/^#{1,3}\s+/, ""));
    const introLines = normalizedLines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"))
      .slice(0, 3);

    return this.normalizeOneLine([...headingLines, ...introLines].join(" / "), 360);
  }

  private async readSmallTextFile(uri: vscode.Uri, maxBytes: number): Promise<string | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > maxBytes) {
        return undefined;
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return undefined;
    }
  }

  private isLikelyTextPath(filePath: string): boolean {
    return /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|js|json|jsx|kt|md|py|rs|scss|ts|tsx|txt|vue|xml|yaml|yml)$/i.test(filePath);
  }

  private normalizeOneLine(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
  }

  private getEffectiveExcludedGlobs(settings: NavigatorSettings): string[] {
    return [...new Set([...settings.protectedExcludedGlobs, ...settings.excludedGlobs])];
  }

  private isPathExcluded(filePath: string, patterns: string[]): boolean {
    const normalizedPath = filePath.replaceAll("\\", "/");
    return patterns.some((pattern) => this.globToRegExp(pattern).test(normalizedPath));
  }

  private globToRegExp(pattern: string): RegExp {
    const escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "__DOUBLE_STAR__")
      .replace(/\*/g, "[^/]*")
      .replace(/__DOUBLE_STAR__/g, ".*")
      .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`);
  }

  private collectRelatedSymbols(editor: vscode.TextEditor, selectedText?: string): string[] {
    const candidates = new Set<string>();

    const selectedToken = this.extractSingleToken(selectedText);
    if (selectedToken) {
      candidates.add(selectedToken);
    }

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (wordRange) {
      const word = editor.document.getText(wordRange).trim();
      if (this.isSymbolCandidate(word)) {
        candidates.add(word);
      }
    }

    const lineText = editor.document.lineAt(editor.selection.active.line).text;
    for (const match of lineText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
      const candidate = match[0];
      if (this.isSymbolCandidate(candidate)) {
        candidates.add(candidate);
      }
      if (candidates.size >= 5) {
        break;
      }
    }

    return [...candidates].slice(0, 5);
  }

  private pruneRecentEdits(records: RecentEditRecord[]): RecentEditRecord[] {
    const threshold = Date.now() - RECENT_EDIT_TTL_MS;
    return records.filter((record) => record.timestamp >= threshold);
  }

  private toRecentEditRecord(change: vscode.TextDocumentContentChangeEvent, previousText?: string): RecentEditRecord {
    const beforeText =
      typeof previousText === "string"
        ? previousText.slice(change.rangeOffset, change.rangeOffset + change.rangeLength)
        : undefined;

    return {
      lineStart: change.range.start.line + 1,
      lineEnd: Math.max(change.range.end.line + 1, change.range.start.line + 1),
      preview: this.toRecentEditPreview(beforeText, change.text),
      timestamp: Date.now()
    };
  }

  private toRecentEditPreview(beforeValue: string | undefined, afterValue: string): string {
    const beforePreview = this.toRecentEditFragment(beforeValue);
    const afterPreview = this.toRecentEditFragment(afterValue);

    if (beforePreview && afterPreview) {
      return `変更前「${beforePreview}」 -> 変更後「${afterPreview}」`;
    }

    if (beforePreview) {
      return `削除「${beforePreview}」`;
    }

    if (afterPreview) {
      return `追加「${afterPreview}」`;
    }

    return "変更前スナップショットなし";
  }

  private toRecentEditFragment(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      return undefined;
    }

    return normalized.length <= MAX_RECENT_EDIT_PREVIEW_LENGTH
      ? normalized
      : `${normalized.slice(0, MAX_RECENT_EDIT_PREVIEW_LENGTH)}...`;
  }

  private extractSingleToken(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!this.isSymbolCandidate(trimmed)) {
      return undefined;
    }

    return trimmed;
  }

  private isSymbolCandidate(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]{1,63}$/.test(value);
  }
}
