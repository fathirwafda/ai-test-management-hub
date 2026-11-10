import fs from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { AiService, createProvider } from "./ai/service.js";
import { AiOutputError, AiProviderError, type LlmProvider } from "./ai/types.js";
import type { AppConfig } from "./config.js";
import { migrate, openDatabase, type Db } from "./db/database.js";
import { ImportFormatError } from "./importers/types.js";
import { EvidenceStore } from "./lib/evidence-store.js";
import { HttpError } from "./lib/errors.js";
import type { Clock } from "./repos/context.js";
import { createStore } from "./repos/store.js";
import { aiRoutes } from "./routes/ai.js";
import { caseRoutes } from "./routes/cases.js";
import type { Deps } from "./routes/deps.js";
import { importRoutes } from "./routes/imports.js";
import { openApiRoutes } from "./routes/openapi.js";
import { projectRoutes } from "./routes/projects.js";
import { runRoutes } from "./routes/runs.js";

export interface BuildAppOptions {
  config: AppConfig;
  db?: Db;
  clock?: Clock;
  provider?: LlmProvider;
  logger?: boolean;
}

const PROVIDER_STATUS: Record<AiProviderError["kind"], number> = {
  auth: 503,
  rate_limit: 429,
  unavailable: 502,
  bad_request: 502,
  refusal: 422,
};

export async function buildApp(options: BuildAppOptions): Promise<{ app: FastifyInstance; deps: Deps }> {
  const { config } = options;
  const db = options.db ?? openDatabase(config.dbFile);
  migrate(db);
  const store = createStore(db, options.clock);
  const evidence = new EvidenceStore(config.uploadDir);
  await evidence.init();
  const ai = new AiService(options.provider ?? createProvider(config));
  const deps: Deps = { config, store, evidence, ai };

  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    bodyLimit: 2 * 1024 * 1024,
  });
  app.addHook("onClose", () => {
    if (!options.db) db.close();
  });

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 10, fields: 20, fieldSize: 10_000 },
    throwFileSizeLimit: true,
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err instanceof ImportFormatError) return reply.code(400).send({ error: err.message });
    if (err instanceof AiOutputError) return reply.code(422).send({ error: err.message, details: err.issues });
    if (err instanceof AiProviderError) {
      req.log.warn({ err }, "AI provider error");
      return reply.code(PROVIDER_STATUS[err.kind]).send({ error: err.message });
    }
    const status = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, "request failed");
      return reply.code(500).send({ error: "Internal server error" });
    }
    return reply.code(status).send({ error: err.message });
  });

  app.get("/api/health", () => ({ ok: true, provider: ai.provider.name }));
  projectRoutes(app, deps);
  caseRoutes(app, deps);
  runRoutes(app, deps);
  importRoutes(app, deps);
  aiRoutes(app, deps);
  openApiRoutes(app);

  const webIndex = config.webDist ? path.join(config.webDist, "index.html") : null;
  if (config.webDist && webIndex && fs.existsSync(webIndex)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, index: ["index.html"] });
    // Single-page app: unknown non-API GET routes get index.html so client-side routing works on reload.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: `Route ${req.method} ${req.url.split("?")[0]} not found` });
    });
  } else {
    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send({ error: `Route ${req.method} ${req.url.split("?")[0]} not found` }),
    );
  }

  return { app, deps };
}
