import type {
  AiStatus,
  GenerateCasesResponse,
  RunDetail,
  RunSummaryResponse,
  TestCase,
  TriageResponse,
} from "@hub/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LlmProvider } from "../../src/ai/types.js";
import { createCase, createProject, startServer, type TestServer } from "./helpers.js";

let s: TestServer;
let projectId: number;
let run: RunDetail;

beforeAll(async () => {
  s = await startServer();
  projectId = (await createProject(s)).id;
  await createCase(s, projectId, { title: "Checkout", platform: "Web", priority: "critical" });
  await createCase(s, projectId, { title: "Search", platform: "API" });
  const created = await s.json<{ id: number }>("POST", `/api/projects/${projectId}/runs`, { name: "RC1" });
  run = (await s.json<RunDetail>("GET", `/api/runs/${created.body.id}`)).body;
});
afterAll(() => s.close());

const caseCount = async () => (await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases`)).body.length;

describe("AI endpoints (mock provider)", () => {
  it("reports the active provider", async () => {
    const res = await s.json<AiStatus>("GET", "/api/ai/status");
    expect(res.body).toEqual({ provider: "mock", model: "mock-rules-v1", models: ["mock-rules-v1"] });
  });

  it("suggests test cases without saving anything", async () => {
    const before = await caseCount();
    const res = await s.json<GenerateCasesResponse>("POST", "/api/ai/generate-cases", {
      story:
        "As a shopper I want to save items for later.\n- Saved items appear in my wishlist\n- When I remove an item, it disappears from the wishlist",
      platformHint: "Mobile-Android",
      maxCases: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ provider: "mock", repaired: false });
    expect(res.body.cases).toHaveLength(2);
    expect(res.body.cases.every((c) => c.platform === "Mobile-Android")).toBe(true);
    expect(await caseCount()).toBe(before);
  });

  it("validates the story", async () => {
    expect((await s.json("POST", "/api/ai/generate-cases", { story: "short" })).status).toBe(400);
    expect((await s.json("POST", "/api/ai/generate-cases", { story: "x".repeat(30), maxCases: 99 })).status).toBe(400);
  });

  it("triages failed results only, using the failure text, and saves nothing", async () => {
    const [failed, passed] = run.items;
    await s.json("PATCH", `/api/run-items/${failed!.id}`, {
      status: "failed",
      comment: "connect ECONNREFUSED 10.0.0.7:443",
    });
    await s.json("PATCH", `/api/run-items/${passed!.id}`, { status: "passed" });

    const res = await s.json<TriageResponse>("POST", `/api/run-items/${failed!.id}/triage`);
    expect(res.status).toBe(200);
    expect(res.body.suggestion.category).toBe("environment");
    const item = (await s.json<RunDetail>("GET", `/api/runs/${run.id}`)).body.items.find((i) => i.id === failed!.id)!;
    expect(item.triage).toBeNull();

    expect((await s.json("POST", `/api/run-items/${passed!.id}/triage`)).status).toBe(400);
  });

  it("summarises a run for release readiness", async () => {
    const res = await s.json<RunSummaryResponse>("POST", `/api/runs/${run.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.summary.verdict).toBe("not_ready"); // the critical case failed
    expect(res.body.summary.risks.join(" ")).toContain(run.items[0]!.caseKey);
  });
});

describe("AI error handling", () => {
  it("returns 422 with the issues when the model output stays invalid after the repair", async () => {
    const broken: LlmProvider = {
      name: "anthropic",
      model: "broken",
      complete: () => Promise.resolve({ text: '{"cases": []}', model: "broken" }),
    };
    const server = await startServer({ provider: broken });
    try {
      const res = await server.json<{ error: string; details: string[] }>("POST", "/api/ai/generate-cases", {
        story: "As a user I want a thing that works well",
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/repair/);
      expect(res.body.details.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});
