import {
  GenerateCasesRequest,
  ProjectInput,
  RunInput,
  RunItemPatch,
  RunPatch,
  SuiteInput,
  TestCaseInput,
  TestCasePatch,
} from "@hub/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

/**
 * A small OpenAPI 3.1 document. Request bodies come from the same zod schemas the handlers validate with, so
 * they cannot drift; responses are described in prose to keep this file short.
 */
type Op = { summary: string; tag: string; body?: z.ZodType; multipart?: Record<string, string>; query?: string[] };

const routes: Record<string, Partial<Record<"get" | "post" | "patch" | "delete", Op>>> = {
  "/api/health": { get: { summary: "Liveness check", tag: "meta" } },
  "/api/ai/status": { get: { summary: "Active AI provider and models", tag: "ai" } },
  "/api/projects": {
    get: { summary: "List projects", tag: "projects" },
    post: { summary: "Create a project", tag: "projects", body: ProjectInput },
  },
  "/api/projects/{projectId}": {
    get: { summary: "Get a project", tag: "projects" },
    patch: { summary: "Update a project", tag: "projects", body: ProjectInput.partial() },
  },
  "/api/projects/{projectId}/suites": {
    get: { summary: "List suites", tag: "suites" },
    post: { summary: "Create a suite", tag: "suites", body: SuiteInput },
  },
  "/api/suites/{suiteId}": {
    patch: { summary: "Update a suite", tag: "suites", body: SuiteInput.partial() },
    delete: { summary: "Delete a suite (its cases become unassigned)", tag: "suites" },
  },
  "/api/projects/{projectId}/cases": {
    get: {
      summary: "List and filter test cases",
      tag: "cases",
      query: ["suiteId", "platforms", "types", "statuses", "priorities", "tags", "q", "needsReview"],
    },
    post: { summary: "Create a test case", tag: "cases", body: TestCaseInput },
  },
  "/api/projects/{projectId}/cases/bulk": {
    post: {
      summary: "Create up to 50 cases in one transaction",
      tag: "cases",
      body: z.object({ cases: z.array(TestCaseInput) }),
    },
  },
  "/api/cases/{caseId}": {
    get: { summary: "Get a test case", tag: "cases" },
    patch: { summary: "Update a test case", tag: "cases", body: TestCasePatch },
    delete: { summary: "Delete a case without results (409 otherwise)", tag: "cases" },
  },
  "/api/cases/{caseId}/history": { get: { summary: "Results of a case across runs", tag: "cases" } },
  "/api/projects/{projectId}/tags": { get: { summary: "Tags used in the project", tag: "cases" } },
  "/api/projects/{projectId}/runs": {
    get: { summary: "List runs with counts and pass rate", tag: "runs" },
    post: { summary: "Create a run from case ids or a filter", tag: "runs", body: RunInput },
  },
  "/api/runs/{runId}": {
    get: { summary: "Run with items and attachments", tag: "runs" },
    patch: { summary: "Update run details or notes", tag: "runs", body: RunPatch },
    delete: { summary: "Delete a run and its evidence files", tag: "runs" },
  },
  "/api/runs/{runId}/close": { post: { summary: "Close a run (read-only afterwards)", tag: "runs" } },
  "/api/runs/{runId}/reopen": { post: { summary: "Reopen a closed run", tag: "runs" } },
  "/api/runs/{runId}/report": {
    get: { summary: "Run report", tag: "runs", query: ["format=md|html|csv", "download=1"] },
  },
  "/api/run-items/{itemId}": { patch: { summary: "Record a result", tag: "runs", body: RunItemPatch } },
  "/api/run-items/{itemId}/attachments": {
    post: { summary: "Upload evidence files", tag: "evidence", multipart: { files: "one or more files" } },
  },
  "/api/attachments/{attachmentId}/content": {
    get: { summary: "Download or preview evidence", tag: "evidence", query: ["download=1"] },
  },
  "/api/attachments/{attachmentId}": { delete: { summary: "Delete evidence", tag: "evidence" } },
  "/api/projects/{projectId}/imports": {
    post: {
      summary: "Import JUnit XML or Playwright JSON results",
      tag: "imports",
      multipart: {
        file: "report file (required)",
        format: "auto | junit | playwright",
        runId: "existing open run",
        runName: "name of the new run",
        environment: "environment of the new run",
        build: "build of the new run",
        platform: "platform for auto-created cases",
        suiteId: "suite for auto-created cases",
        executedBy: "recorded on each result",
      },
    },
  },
  "/api/projects/{projectId}/dashboard": {
    get: { summary: "Totals, coverage, trend and flaky candidates", tag: "dashboard" },
  },
  "/api/ai/generate-cases": {
    post: { summary: "Suggest test cases from a story (not saved)", tag: "ai", body: GenerateCasesRequest },
  },
  "/api/run-items/{itemId}/triage": { post: { summary: "Suggest a failure cause (not saved)", tag: "ai" } },
  "/api/runs/{runId}/summary": { post: { summary: "Suggest a release-readiness summary (not saved)", tag: "ai" } },
};

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const [path, ops] of Object.entries(routes)) {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "integer" },
    }));
    const out: Record<string, unknown> = {};
    for (const [method, op] of Object.entries(ops)) {
      const operation: Record<string, unknown> = {
        summary: op.summary,
        tags: [op.tag],
        parameters: [
          ...params,
          ...(op.query ?? []).map((q) => ({
            name: q.split("=")[0],
            in: "query",
            required: false,
            description: q,
            schema: { type: "string" },
          })),
        ],
        responses: {
          "200": { description: "OK" },
          "400": { description: "Validation error" },
          "404": { description: "Not found" },
        },
      };
      if (op.body) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: z.toJSONSchema(op.body, { io: "input", unrepresentable: "any" }) } },
        };
      }
      if (op.multipart) {
        operation.requestBody = {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: Object.fromEntries(
                  Object.entries(op.multipart).map(([k, d]) => [
                    k,
                    { type: "string", description: d, ...(k === "file" || k === "files" ? { format: "binary" } : {}) },
                  ]),
                ),
              },
            },
          },
        };
      }
      out[method] = operation;
    }
    paths[path] = out;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "AI Test Management Hub API",
      version: "0.1.0",
      description:
        "Test cases, runs, evidence, results import, dashboard and AI suggestions. No authentication: run it locally or behind your own proxy.",
    },
    paths,
  };
}

export function openApiRoutes(app: FastifyInstance): void {
  const doc = buildOpenApi();
  app.get("/api/openapi.json", () => doc);
}
