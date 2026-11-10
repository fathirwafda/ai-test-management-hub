import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Project, Suite, TestCase } from "@hub/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import type { LlmProvider } from "../../src/ai/types.js";
import type { Deps } from "../../src/routes/deps.js";

export interface TestServer {
  app: FastifyInstance;
  deps: Deps;
  base: string;
  dir: string;
  close(): Promise<void>;
  json<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: T; headers: Headers }>;
  form<T = unknown>(url: string, form: FormData): Promise<{ status: number; body: T }>;
}

/** Starts the real app on a random port with its own temporary database and upload directory. */
export async function startServer(options: { provider?: LlmProvider; maxUploadMb?: number } = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-api-test-"));
  const config = loadConfig({
    DATA_DIR: dir,
    LLM_PROVIDER: "mock",
    SERVE_WEB: "false",
    LOG_LEVEL: "silent",
    MAX_UPLOAD_MB: String(options.maxUploadMb ?? 5),
  });
  const { app, deps } = await buildApp({
    config,
    logger: false,
    ...(options.provider ? { provider: options.provider } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  return {
    app,
    deps,
    base,
    dir,
    async close() {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async json<T>(method: string, url: string, body?: unknown) {
      const res = await fetch(base + url, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
    },
    async form<T>(url: string, form: FormData) {
      const res = await fetch(base + url, { method: "POST", body: form });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}

export async function createProject(s: TestServer, name = "Shop"): Promise<Project> {
  return (await s.json<Project>("POST", "/api/projects", { name })).body;
}

export async function createSuite(s: TestServer, projectId: number, name = "Checkout"): Promise<Suite> {
  return (await s.json<Suite>("POST", `/api/projects/${projectId}/suites`, { name })).body;
}

export async function createCase(
  s: TestServer,
  projectId: number,
  over: Record<string, unknown> = {},
): Promise<TestCase> {
  const res = await s.json<TestCase>("POST", `/api/projects/${projectId}/cases`, {
    title: "Pays with a saved card",
    platform: "Web",
    status: "ready",
    ...over,
  });
  if (res.status !== 201) throw new Error(`createCase failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const fixture = (name: string) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
