import fs from "node:fs/promises";
import {
  AiModelChoice,
  CLAUDE_MODELS,
  GenerateCasesRequest,
  type AiStatus,
  type GenerateCasesResponse,
  type RunSummaryResponse,
  type TriageResponse,
} from "@hub/shared";
import type { FastifyInstance } from "fastify";
import type { TriageInput } from "../ai/types.js";
import { badRequest, idParam, parse } from "../lib/errors.js";
import type { Deps } from "./deps.js";

const MAX_LOG_CHARS = 4000;

/**
 * AI endpoints. Every one returns a suggestion and saves nothing: the UI shows it to a person, who edits and
 * explicitly saves what they want to keep through the normal endpoints.
 */
export function aiRoutes(app: FastifyInstance, { store, ai, evidence }: Deps): void {
  const modelFor = (body: unknown) => {
    const { model } = parse(AiModelChoice, body ?? {});
    return ai.provider.name === "anthropic" ? model : undefined;
  };

  app.get("/api/ai/status", (): AiStatus => ({
    provider: ai.provider.name,
    model: ai.provider.model,
    models: ai.provider.name === "anthropic" ? [...CLAUDE_MODELS] : [ai.provider.model],
  }));

  app.post("/api/ai/generate-cases", async (req): Promise<GenerateCasesResponse> => {
    const input = parse(GenerateCasesRequest, req.body);
    const { cases, meta } = await ai.generateCases(
      { story: input.story, platformHint: input.platformHint, maxCases: input.maxCases },
      modelFor(req.body),
    );
    return { cases, meta };
  });

  app.post<{ Params: { itemId: string } }>("/api/run-items/:itemId/triage", async (req): Promise<TriageResponse> => {
    const item = store.runs.getItem(idParam(req.params.itemId));
    if (item.status !== "failed" && item.status !== "blocked" && item.status !== "retest") {
      throw badRequest("Triage is available for failed, blocked or retest results");
    }
    const logs: string[] = [];
    for (const a of item.attachments.filter((x) => x.kind === "text" && x.stored).slice(0, 3)) {
      const row = store.attachments.row(a.id);
      const text = await fs.readFile(evidence.resolve(row.storage_key!), "utf8").catch(() => "");
      if (text) logs.push(`--- ${a.fileName} ---\n${text.slice(-MAX_LOG_CHARS)}`);
    }
    const history = store.cases
      .history(item.caseId)
      .filter((h) => h.runId !== item.runId)
      .reverse()
      .map((h) => h.status);
    const input: TriageInput = {
      caseKey: item.caseKey,
      caseTitle: item.caseTitle,
      platform: item.platform,
      automationRef: item.automationRef,
      status: item.status,
      failureMessage: item.failureMessage,
      details: [item.failureDetails.slice(0, 8000), ...logs].filter(Boolean).join("\n\n"),
      comment: item.comment,
      previousStatuses: history,
    };
    const { suggestion, meta } = await ai.triage(input, modelFor(req.body));
    return { suggestion, meta };
  });

  app.post<{ Params: { runId: string } }>("/api/runs/:runId/summary", async (req): Promise<RunSummaryResponse> => {
    const run = store.runs.detail(idParam(req.params.runId));
    const { summary, meta } = await ai.runSummary(
      {
        name: run.name,
        environment: run.environment,
        build: run.build,
        counts: run.counts,
        passRate: run.passRate,
        items: run.items.map((i) => ({
          key: i.caseKey,
          title: i.caseTitle,
          platform: i.platform,
          priority: i.priority,
          status: i.status,
          failureMessage: i.failureMessage.split("\n")[0] ?? "",
          triageCategory: i.triage?.category ?? null,
        })),
      },
      modelFor(req.body),
    );
    return { summary, meta };
  });
}
