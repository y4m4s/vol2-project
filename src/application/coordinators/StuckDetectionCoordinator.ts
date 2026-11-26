import * as vscode from "vscode";
import { normalizeDiagnosticCode } from "../../services/ContextCollector";
import {
  StuckSignalTracker,
  diagnosticKindKey,
  type StuckDiagnosticInput,
  type StuckEvent
} from "../../services/StuckSignalTracker";

export interface StuckDetectionHost {
  /** 学習プロファイルの「つまずきの記録」がオンか */
  isEnabled(): boolean;
  /** 送信対象から除外したファイル（保護・追加の除外パターン）か */
  isExcluded(filePath: string): boolean;
  /** NaviCom Diagnostics への記録 */
  log(entry: Record<string, unknown>): void;
}

const MAX_DIAGNOSTICS_PER_DOCUMENT = 50;

/**
 * つまずき検知のシャドーモード（Phase 3a）。VS Code のイベントを StuckSignalTracker へ渡し、
 * 状態の変化を NaviCom Diagnostics に記録するだけで、表示や AI の呼び出しはしない。
 *
 * - 既存のイベント購読（NavigatorController）から通知を受ける。新しく購読するのはウィンドウのフォーカスだけ
 * - 対象はワークスペース内の file スキームの文書で、除外ファイルは追跡しない
 * - タイマーはポーリングではなく、追跡器が返す「次の期限」に1つだけ張る
 * - 記録にはコード・診断メッセージ・ファイルパスを含めない
 */
export class StuckDetectionCoordinator implements vscode.Disposable {
  private readonly tracker = new StuckSignalTracker();
  private readonly languageByDocument = new Map<string, string>();
  /** 追跡中の文書のパス。除外パターンの変更を、イベントを待たずに反映するために持つ（記録には使わない） */
  private readonly pathByDocument = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private focused: boolean;
  private enabled: boolean;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly host: StuckDetectionHost, private readonly now: () => number = Date.now) {
    this.focused = vscode.window?.state?.focused ?? true;
    this.enabled = host.isEnabled();
    const windowState = vscode.window?.onDidChangeWindowState?.((state) => {
      this.focused = state.focused;
      this.evaluate();
    });
    if (windowState) this.disposables.push(windowState);
  }

  /** 設定の変更を反映する。オフにしたら追跡中の状態をすべて捨てる。除外パターンに入った文書の状態も捨てる。 */
  public refresh(): void {
    const enabled = this.host.isEnabled();
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      if (!enabled) {
        this.tracker.clear();
        this.languageByDocument.clear();
        this.pathByDocument.clear();
        this.clearTimer();
      }
      this.host.log({ event: "stuck_detection_toggled", enabled });
    }
    if (this.enabled && this.releaseExcluded()) this.schedule();
  }

  public noteTextChange(event: vscode.TextDocumentChangeEvent): void {
    const key = this.trackedKey(event.document);
    if (!key || event.contentChanges.length === 0) return;
    this.tracker.noteEdit(key, event.contentChanges.map((change) => ({
      startLine: change.range.start.line,
      endLine: change.range.end.line,
      insertedLineCount: countLineBreaks(change.text),
      insertedChars: change.text.length,
      deletedChars: change.rangeLength
    })), this.now());
    this.evaluate();
  }

  public noteSelection(document: vscode.TextDocument): void {
    const key = this.trackedKey(document);
    if (!key) return;
    this.tracker.noteActivity(key, this.now());
    this.schedule();
  }

  /** 診断の変化。対象は開いている文書だけ（ワークスペース全体の再解析で大量の URI が来ても読まない）。 */
  public noteDiagnostics(uris: readonly vscode.Uri[]): void {
    if (!this.enabled) return;
    const changed = new Set(uris.map((uri) => uri.toString()));
    const documents = (vscode.workspace?.textDocuments ?? []).filter((document) => changed.has(document.uri.toString()));
    if (!documents.length) return;
    const now = this.now();
    for (const document of documents) {
      const key = this.trackedKey(document);
      if (!key) continue;
      const diagnostics = vscode.languages.getDiagnostics(document.uri).slice(0, MAX_DIAGNOSTICS_PER_DOCUMENT).map(toStuckDiagnostic);
      this.record(this.tracker.noteDiagnostics(key, diagnostics, now));
    }
    this.evaluate();
  }

  /** 手動相談の質問（編集中の文書に結び付ける）。保持するのはトークンの集合だけ。 */
  public noteQuestion(text: string | undefined): void {
    const document = vscode.window?.activeTextEditor?.document;
    const key = document ? this.trackedKey(document) : undefined;
    if (!key || !text?.trim()) return;
    this.tracker.noteQuestion(key, text, this.now());
    this.evaluate();
  }

  /** ファイル名の変更など、複数ファイルにまたがる変更（リファクタリング）。 */
  public noteBulkChange(): void {
    if (!this.enabled) return;
    this.tracker.noteBulkChange(this.now());
  }

  public releaseDocument(uri: vscode.Uri): void {
    this.forget(uri.toString());
    this.schedule();
  }

  public dispose(): void {
    this.clearTimer();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private trackedKey(document: vscode.TextDocument): string | undefined {
    if (!this.enabled || document.uri.scheme !== "file") return undefined;
    if (!vscode.workspace?.getWorkspaceFolder?.(document.uri)) return undefined;
    if (this.host.isExcluded(document.uri.fsPath)) {
      // 除外パターンへ追加された文書は、それまでの記録も捨てる。
      this.forget(document.uri.toString());
      return undefined;
    }
    const key = document.uri.toString();
    this.languageByDocument.set(key, document.languageId);
    this.pathByDocument.set(key, document.uri.fsPath);
    return key;
  }

  private forget(key: string): void {
    this.tracker.releaseDocument(key);
    this.languageByDocument.delete(key);
    this.pathByDocument.delete(key);
  }

  /** 追跡を始めた後に除外パターンへ入った文書の状態を捨てる。捨てた文書があれば true。 */
  private releaseExcluded(): boolean {
    let released = false;
    for (const [key, fsPath] of [...this.pathByDocument]) {
      if (!this.host.isExcluded(fsPath)) continue;
      this.forget(key);
      released = true;
    }
    return released;
  }

  private evaluate(): void {
    if (!this.enabled) return;
    // タイマー・フォーカスの変化からの評価でも、除外した文書は判定しない。
    this.releaseExcluded();
    this.record(this.tracker.evaluate(this.now(), {
      focused: this.focused,
      debugging: Boolean(vscode.debug?.activeDebugSession)
    }));
    this.schedule();
  }

  private record(events: readonly StuckEvent[]): void {
    for (const event of events) {
      const language = this.languageByDocument.get(event.documentKey);
      if (event.type === "transition") {
        this.host.log({ event: "stuck_assessment", topic: event.kind, topicId: event.topicId, language, code: event.code,
          from: event.from, to: event.to, score: event.score, groups: event.groups.join(""), durationSec: Math.round(event.durationMs / 1000) });
      } else if (event.type === "resolved") {
        this.host.log({ event: "stuck_resolved", topicId: event.topicId, language, code: event.code,
          lastState: event.lastState, durationSec: Math.round(event.durationMs / 1000) });
      } else {
        this.host.log({ event: "stuck_reopened", topicId: event.topicId, language, code: event.code });
      }
    }
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.enabled) return;
    const now = this.now();
    const deadline = this.tracker.nextDeadline(now);
    if (deadline === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.evaluate();
    }, Math.max(0, deadline - now) + 50);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function toStuckDiagnostic(diagnostic: vscode.Diagnostic): StuckDiagnosticInput {
  const code = normalizeDiagnosticCode(diagnostic.code);
  return {
    kindKey: diagnosticKindKey(diagnostic.source, code, diagnostic.message),
    code,
    severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error"
      : diagnostic.severity === vscode.DiagnosticSeverity.Warning ? "warning" : "info",
    startLine: diagnostic.range.start.line,
    endLine: diagnostic.range.end.line
  };
}

function countLineBreaks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}
