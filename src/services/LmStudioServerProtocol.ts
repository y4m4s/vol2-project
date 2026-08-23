export interface LmStudioCliStatus {
  running: boolean;
  port?: number;
}

export interface LmStudioLocalServerTarget {
  origin: string;
  port: number;
}

export type LmStudioModelsHttpResponseKind = "lmStudio" | "auth" | "occupied";

export function classifyLmStudioModelsHttpResponse(
  status: number,
  ok: boolean,
  responseText: string
): LmStudioModelsHttpResponseKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (!ok) {
    return "occupied";
  }

  try {
    const payload = JSON.parse(responseText) as unknown;
    return isRecord(payload) && Array.isArray(payload.models) ? "lmStudio" : "occupied";
  } catch {
    return "occupied";
  }
}

export function parseLmStudioCliStatus(output: string): LmStudioCliStatus {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(lines[index]) as unknown;
      if (isRecord(payload) && typeof payload.running === "boolean") {
        return {
          running: payload.running,
          port: typeof payload.port === "number" && Number.isInteger(payload.port) ? payload.port : undefined
        };
      }
    } catch {
      // Continue searching in case the CLI printed a log line before the JSON payload.
    }
  }
  throw new Error("LM Studio CLI returned invalid status JSON.");
}

export function parseLmStudioLocalServerUrl(baseUrl: string): LmStudioLocalServerTarget {
  const url = new URL(baseUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "http:" ||
    (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("LM Studio server URL must be a local HTTP root URL.");
  }

  const port = url.port ? Number(url.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LM Studio server URL has an invalid port.");
  }
  return { origin: url.origin, port };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
