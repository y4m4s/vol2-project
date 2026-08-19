import { execFile } from "node:child_process";
import { Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { LmStudioServerViewData } from "../shared/types";
import {
  parseLmStudioCliStatus,
  parseLmStudioLocalServerUrl,
  type LmStudioCliStatus
} from "./LmStudioServerProtocol";

const CLI_TIMEOUT_MS = 15_000;
const CLI_START_TIMEOUT_MS = 75_000;
const PROBE_TIMEOUT_MS = 2_000;
const TRANSITION_TIMEOUT_MS = 10_000;
const TRANSITION_POLL_MS = 250;

interface CliResult {
  stdout: string;
  stderr: string;
}

type HttpProbe = "lmStudio" | "occupied" | "unreachable";

export class LmStudioServerService implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("NaviCom LM Studio");
  private resolvedCliPath?: string;

  public async getStatus(baseUrl: string): Promise<LmStudioServerViewData> {
    const target = parseLmStudioLocalServerUrl(baseUrl);
    const [cliResult, probe] = await Promise.all([
      this.readCliStatus(),
      this.probeHttp(target.origin)
    ]);

    if (probe === "lmStudio") {
      const port = cliResult.status?.port ?? target.port;
      this.log(`Server status: running on port ${port}.`);
      return {
        state: "running",
        port,
        canStart: false,
        canStop: cliResult.available,
        message: cliResult.available
          ? `起動中 · localhost:${port}`
          : `起動中 · localhost:${port}（停止操作には LM Studio CLI が必要です）`
      };
    }

    if (
      probe === "occupied" &&
      cliResult.available &&
      cliResult.status?.running &&
      (cliResult.status.port === undefined || cliResult.status.port === target.port)
    ) {
      this.log(`Server process reports running on port ${target.port}, but its API response requires attention.`);
      return {
        state: "running",
        port: target.port,
        canStart: false,
        canStop: true,
        message: `起動中 · localhost:${target.port}（APIの応答を確認してください）`
      };
    }

    if (probe === "occupied") {
      this.log(`Server status: port ${target.port} is occupied by a non-LM Studio service.`);
      return {
        state: "portConflict",
        port: target.port,
        canStart: false,
        canStop: false,
        message: `ポート${target.port}が別のアプリで使用されています。`
      };
    }

    if (!cliResult.available) {
      this.log("Server status: LM Studio CLI is unavailable.");
      return {
        state: "cliUnavailable",
        port: target.port,
        canStart: false,
        canStop: false,
        message: "LM Studio CLI が見つかりません。LM Studio を一度起動してください。"
      };
    }

    if (cliResult.error) {
      this.log(`Server status failed: ${cliResult.error}`);
      return {
        state: "error",
        port: target.port,
        canStart: true,
        canStop: false,
        message: "LM Studio サーバーの状態を取得できませんでした。"
      };
    }

    if (cliResult.status?.running) {
      const port = cliResult.status.port ?? target.port;
      this.log(`Server process reports running on port ${port}, but its API is not ready.`);
      return {
        state: "running",
        port,
        canStart: false,
        canStop: true,
        message: `起動中 · localhost:${port}（APIの応答待ち）`
      };
    }

    this.log(`Server status: stopped (port ${target.port}).`);
    return {
      state: "stopped",
      port: target.port,
      canStart: true,
      canStop: false,
      message: "停止中"
    };
  }

  public async start(baseUrl: string): Promise<LmStudioServerViewData> {
    const target = parseLmStudioLocalServerUrl(baseUrl);
    const current = await this.getStatus(baseUrl);
    if (current.state === "running" || current.state === "portConflict") {
      return current;
    }
    if (current.state === "cliUnavailable") {
      return current;
    }

    this.log(`Starting LM Studio server on 127.0.0.1:${target.port}.`);
    try {
      await this.runCli([
        "server",
        "start",
        "--port",
        String(target.port),
        "--bind",
        "127.0.0.1"
      ], CLI_START_TIMEOUT_MS);
    } catch (error) {
      const message = toErrorMessage(error);
      this.log(`Server start failed: ${message}`);
      return {
        state: isMissingExecutable(error) ? "cliUnavailable" : "error",
        port: target.port,
        canStart: !isMissingExecutable(error),
        canStop: false,
        message: isMissingExecutable(error)
          ? "LM Studio CLI が見つかりません。LM Studio を一度起動してください。"
          : "LM Studio サーバーを起動できませんでした。"
      };
    }

    const probe = await this.waitForProbe(target.origin, "lmStudio");
    if (probe === "lmStudio") {
      this.log(`Server start completed on port ${target.port}.`);
      return {
        state: "running",
        port: target.port,
        canStart: false,
        canStop: true,
        message: `起動中 · localhost:${target.port}`
      };
    }

    if (probe === "occupied") {
      return {
        state: "portConflict",
        port: target.port,
        canStart: false,
        canStop: false,
        message: `ポート${target.port}が別のアプリで使用されています。`
      };
    }

    this.log("Server start timed out while waiting for the HTTP API.");
    return {
      state: "error",
      port: target.port,
      canStart: true,
      canStop: true,
      message: "サーバーの起動を確認できませんでした。"
    };
  }

  public async stop(baseUrl: string): Promise<LmStudioServerViewData> {
    const target = parseLmStudioLocalServerUrl(baseUrl);
    this.log(`Stopping LM Studio server on port ${target.port}.`);
    try {
      await this.runCli(["server", "stop"]);
    } catch (error) {
      const message = toErrorMessage(error);
      this.log(`Server stop failed: ${message}`);
      return {
        state: isMissingExecutable(error) ? "cliUnavailable" : "error",
        port: target.port,
        canStart: false,
        canStop: !isMissingExecutable(error),
        message: isMissingExecutable(error)
          ? "LM Studio CLI が見つからないため停止できません。"
          : "LM Studio サーバーを停止できませんでした。"
      };
    }

    const probe = await this.waitForProbe(target.origin, "unreachable");
    if (probe === "unreachable") {
      this.log("Server stop completed.");
      return {
        state: "stopped",
        port: target.port,
        canStart: true,
        canStop: false,
        message: "停止中"
      };
    }

    this.log("Server stop timed out while waiting for the HTTP API to close.");
    return {
      state: probe === "occupied" ? "portConflict" : "error",
      port: target.port,
      canStart: false,
      canStop: probe === "lmStudio",
      message: probe === "occupied"
        ? `LM Studio は停止しましたが、ポート${target.port}が別のアプリで使用されています。`
        : "サーバーの停止を確認できませんでした。"
    };
  }

  public dispose(): void {
    this.output.dispose();
  }

  private async readCliStatus(): Promise<{
    available: boolean;
    status?: LmStudioCliStatus;
    error?: string;
  }> {
    try {
      const result = await this.runCli(["server", "status", "--json", "--quiet"]);
      return { available: true, status: parseLmStudioCliStatus(result.stdout) };
    } catch (error) {
      if (isMissingExecutable(error)) {
        return { available: false };
      }
      return { available: true, error: toErrorMessage(error) };
    }
  }

  private async runCli(args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<CliResult> {
    if (this.resolvedCliPath) {
      return this.exec(this.resolvedCliPath, args, timeoutMs);
    }

    let lastMissingError: unknown;
    for (const candidate of cliCandidates()) {
      try {
        const result = await this.exec(candidate, args, timeoutMs);
        this.resolvedCliPath = candidate;
        this.log(`Using LM Studio CLI: ${candidate}`);
        return result;
      } catch (error) {
        if (!isMissingExecutable(error)) {
          this.resolvedCliPath = candidate;
          throw error;
        }
        lastMissingError = error;
      }
    }
    throw lastMissingError ?? new Error("LM Studio CLI was not found.");
  }

  private exec(executable: string, args: string[], timeoutMs: number): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }

  private async probeHttp(origin: string): Promise<HttpProbe> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${origin}/api/v1/models`, { signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        return "occupied";
      }
      try {
        const payload = JSON.parse(text) as unknown;
        return isRecord(payload) && Array.isArray(payload.models) ? "lmStudio" : "occupied";
      } catch {
        return "occupied";
      }
    } catch {
      return await this.isTcpPortOpen(origin) ? "occupied" : "unreachable";
    } finally {
      clearTimeout(timeout);
    }
  }

  private async isTcpPortOpen(origin: string): Promise<boolean> {
    const url = new URL(origin);
    const port = url.port ? Number(url.port) : 80;
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      const finish = (open: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(500);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
      socket.connect(port, url.hostname.replace(/^\[|\]$/g, ""));
    });
  }

  private async waitForProbe(origin: string, expected: HttpProbe): Promise<HttpProbe> {
    const deadline = Date.now() + TRANSITION_TIMEOUT_MS;
    let latest = await this.probeHttp(origin);
    while (latest !== expected && Date.now() < deadline) {
      await delay(TRANSITION_POLL_MS);
      latest = await this.probeHttp(origin);
    }
    return latest;
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function cliCandidates(): string[] {
  const executable = process.platform === "win32" ? "lms.exe" : "lms";
  return [...new Set([
    executable,
    join(homedir(), ".lmstudio", "bin", executable)
  ])];
}

function isMissingExecutable(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
