import type { WebviewToExtension } from "../../../shared/messages";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const api = acquireVsCodeApi();

export function postMessage(message: WebviewToExtension): void {
  api.postMessage(message);
}
