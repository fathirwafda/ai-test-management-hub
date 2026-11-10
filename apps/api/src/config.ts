import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "@hub/shared";

/** apps/api/src or apps/api/dist -> repository root. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  uploadDir: string;
  maxUploadBytes: number;
  /** Built web app to serve. Null disables static serving (dev mode uses Vite). */
  webDist: string | null;
  llmProvider: "mock" | "anthropic";
  llmModel: string;
  anthropicApiKey: string | undefined;
  logLevel: string;
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(repoRoot, env.DATA_DIR ?? "data");
  const apiKey = env.ANTHROPIC_API_KEY || undefined;

  const requested = env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested && requested !== "mock" && requested !== "anthropic") {
    throw new Error(`LLM_PROVIDER must be "mock" or "anthropic", got "${env.LLM_PROVIDER}"`);
  }
  // Mock by default; Claude only when a key is present (or explicitly requested).
  const llmProvider = (requested as "mock" | "anthropic" | undefined) ?? (apiKey ? "anthropic" : "mock");

  const llmModel = env.LLM_MODEL ?? DEFAULT_CLAUDE_MODEL;
  if (llmProvider === "anthropic" && !(CLAUDE_MODELS as readonly string[]).includes(llmModel)) {
    throw new Error(`LLM_MODEL must be one of ${CLAUDE_MODELS.join(", ")}, got "${llmModel}"`);
  }

  const webDistDefault = path.join(repoRoot, "apps/web/dist");
  return {
    port: int(env.PORT, 4000, "PORT"),
    host: env.HOST ?? "127.0.0.1",
    dataDir,
    dbFile: env.DB_FILE ? path.resolve(repoRoot, env.DB_FILE) : path.join(dataDir, "hub.sqlite"),
    uploadDir: env.UPLOAD_DIR ? path.resolve(repoRoot, env.UPLOAD_DIR) : path.join(dataDir, "uploads"),
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 25, "MAX_UPLOAD_MB") * 1024 * 1024,
    webDist: env.SERVE_WEB === "false" ? null : env.WEB_DIST ? path.resolve(repoRoot, env.WEB_DIST) : webDistDefault,
    llmProvider,
    llmModel: llmProvider === "mock" ? "mock-rules-v1" : llmModel,
    anthropicApiKey: apiKey,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
