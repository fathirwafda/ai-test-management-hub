import { GeneratedCases, RunSummarySuggestion, TriageSuggestion, countStatuses } from "@hub/shared";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../../src/ai/anthropic.js";
import { extractCriteria, MockProvider, mockGenerateCases, mockRunSummary, mockTriage } from "../../src/ai/mock.js";
import { generateCasesPrompt } from "../../src/ai/prompts.js";
import { AiService, extractJson, runStructured } from "../../src/ai/service.js";
import {
  AiOutputError,
  AiProviderError,
  type CompletionRequest,
  type LlmProvider,
  type TriageInput,
} from "../../src/ai/types.js";

const STORY = `As a shopper, I want to apply a discount code at checkout so that I pay less.
- A valid code reduces the order total
- When the code is expired, an inline error is shown and the total does not change
- The discount line should look consistent with the order summary design`;

const triageInput = (over: Partial<TriageInput> = {}): TriageInput => ({
  caseKey: "TC-1",
  caseTitle: "Checkout",
  platform: "Web",
  automationRef: null,
  status: "failed",
  failureMessage: "",
  details: "",
  comment: "",
  previousStatuses: [],
  ...over,
});

/** A provider that replays canned replies and records the requests it got. */
function scripted(replies: string[]): LlmProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    name: "anthropic",
    model: "scripted",
    requests,
    complete(req) {
      requests.push(req);
      return Promise.resolve({ text: replies[requests.length - 1] ?? "", model: "scripted" });
    },
  };
}

describe("extractJson", () => {
  it("accepts bare JSON, fenced JSON and JSON surrounded by prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} hope it helps')).toEqual({ a: 3 });
    expect(() => extractJson("no json at all")).toThrow();
  });
});

describe("runStructured (validation + one repair)", () => {
  const prompt = { system: "s", user: "u" };
  const task = { kind: "triage" as const, input: triageInput() };
  const valid = JSON.stringify(mockTriage(triageInput({ failureMessage: "ECONNREFUSED" })));

  it("returns valid output without a repair call", async () => {
    const p = scripted([valid]);
    const { data, meta } = await runStructured(p, TriageSuggestion, prompt, task, { maxTokens: 100 });
    expect(data.category).toBe("environment");
    expect(meta).toEqual({ provider: "anthropic", model: "scripted", repaired: false });
    expect(p.requests).toHaveLength(1);
  });

  it("sends the validation errors back once and accepts the repaired answer", async () => {
    const p = scripted(['{"category":"cosmic_rays"}', valid]);
    const { meta } = await runStructured(p, TriageSuggestion, prompt, task, { maxTokens: 100 });
    expect(meta.repaired).toBe(true);
    expect(p.requests).toHaveLength(2);
    const repair = p.requests[1]!;
    expect(repair.attempt).toBe(1);
    expect(repair.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(repair.messages[2]!.content).toContain("category");
  });

  it("gives up after the repair attempt with the remaining issues", async () => {
    const p = scripted(["not json", '{"category":"data"}']);
    const err = await runStructured(p, TriageSuggestion, prompt, task, { maxTokens: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiOutputError);
    expect((err as AiOutputError).issues.join(" ")).toMatch(/summary|reasoning|nextSteps/);
    expect(p.requests).toHaveLength(2);
  });
});

describe("MockProvider", () => {
  it("is deterministic and always produces schema-valid output", async () => {
    const service = new AiService(new MockProvider());
    const a = await service.generateCases({ story: STORY, maxCases: 8 });
    const b = await service.generateCases({ story: STORY, maxCases: 8 });
    expect(a).toEqual(b);
    expect(a.meta).toEqual({ provider: "mock", model: "mock-rules-v1", repaired: false });
    expect(GeneratedCases.safeParse({ cases: a.cases }).success).toBe(true);
  });

  it("turns each acceptance criterion into a case with Given/When/Then steps", () => {
    const cases = mockGenerateCases({ story: STORY, maxCases: 8 });
    expect(cases).toHaveLength(3);
    expect(cases[1]!.title).toBe("An inline error is shown and the total does not change when the code is expired");
    expect(cases[1]!.steps.map((s) => s.keyword)).toEqual(["Given", "And", "When", "Then"]);
    expect(cases[1]!.tags).toContain("negative");
    expect(cases[2]!.suggestedType).toBe("manual"); // visual check
    expect(cases[0]!.suggestedType).toBe("automated");
  });

  it("honours the platform hint and max cases, and handles stories without criteria", () => {
    expect(mockGenerateCases({ story: STORY, maxCases: 1, platformHint: "Mobile-iOS" })).toMatchObject([
      { platform: "Mobile-iOS" },
    ]);
    const fallback = mockGenerateCases({ story: "Make the API faster for everybody please", maxCases: 5 });
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.platform).toBe("API");
  });

  it("extracts Gherkin scenarios as single criteria", () => {
    const criteria = extractCriteria(
      "Scenario: pay\nGiven a cart\nWhen I pay\nThen I see a receipt\nScenario: fail\nGiven a cart\nWhen the card is declined\nThen I see an error",
    );
    expect(criteria).toEqual([
      "Given a cart When I pay Then I see a receipt",
      "Given a cart When the card is declined Then I see an error",
    ]);
  });

  it.each([
    ["environment", "connect ECONNREFUSED 10.0.0.1:443"],
    ["environment", "SessionNotCreatedException: Could not start a new session. emulator device offline"],
    ["test_issue", "TimeoutError: locator.click: Timeout 30000ms exceeded. waiting for getByRole('button')"],
    ["data", "409 Conflict: customer already exists"],
    ["product_bug", "AssertionError: Expected status code <422> but was <200>."],
  ])("triages %s failures", (category, failureMessage) => {
    const s = mockTriage(triageInput({ failureMessage }));
    expect(s.category).toBe(category);
    expect(TriageSuggestion.safeParse(s).success).toBe(true);
    expect(s.signals.length).toBeGreaterThan(0);
  });

  it("says so when there is no signal, with low confidence", () => {
    const s = mockTriage(triageInput({ failureMessage: "something odd" }));
    expect(s).toMatchObject({ category: "product_bug", confidence: "low" });
  });

  it("summarises a run with a verdict that follows the high-priority failures", () => {
    const item = (status: "passed" | "failed" | "untested", priority: "critical" | "low" = "low") => ({
      key: `TC-${Math.random()}`,
      title: "t",
      platform: "Web" as const,
      priority,
      status,
      failureMessage: "",
      triageCategory: null,
    });
    const base = { name: "R", environment: "", build: "" };
    const ready = mockRunSummary({
      ...base,
      counts: countStatuses(["passed", "passed"]),
      passRate: 1,
      items: [item("passed"), item("passed")],
    });
    expect(ready.verdict).toBe("ready");
    const risky = mockRunSummary({
      ...base,
      counts: countStatuses(["passed", "failed"]),
      passRate: 0.5,
      items: [item("passed"), item("failed")],
    });
    expect(risky.verdict).toBe("ready_with_risks");
    const blocked = mockRunSummary({
      ...base,
      counts: countStatuses(["passed", "failed"]),
      passRate: 0.5,
      items: [item("passed"), item("failed", "critical")],
    });
    expect(blocked.verdict).toBe("not_ready");
    for (const s of [ready, risky, blocked]) expect(RunSummarySuggestion.safeParse(s).success).toBe(true);
  });
});

describe("prompts", () => {
  it("wraps the user story in tags and asks for JSON only", () => {
    const p = generateCasesPrompt({ story: "As a user I want X", maxCases: 3 });
    expect(p.user).toContain("<story>\nAs a user I want X\n</story>");
    expect(p.user).toContain("at most 3 test cases");
    expect(p.system).toContain("single JSON object");
  });
});

describe("AnthropicProvider (fake client, no network)", () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"ok":true}' }],
    ...over,
  });

  it("sends system + messages to the configured model with the refusal fallback", async () => {
    const create = vi.fn().mockResolvedValue(reply());
    const provider = new AnthropicProvider({
      model: "claude-sonnet-5-5",
      client: { beta: { messages: { create } } } as never,
    });
    const res = await provider.complete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 500,
      task: { kind: "triage", input: triageInput() },
      attempt: 0,
    });
    expect(res).toEqual({ text: '{"ok":true}', model: "claude-sonnet-5-5" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        max_tokens: 500,
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
    );
  });

  it("uses a per-request model and skips the fallback where it is not supported", async () => {
    const create = vi.fn().mockResolvedValue(reply({ model: "claude-haiku-5-5" }));
    const provider = new AnthropicProvider({ client: { beta: { messages: { create } } } as never });
    await provider.complete({
      system: "s",
      messages: [],
      maxTokens: 10,
      model: "claude-haiku-5-5",
      task: { kind: "triage", input: triageInput() },
      attempt: 0,
    });
    const args = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.model).toBe("claude-haiku-5-5");
    expect(args).not.toHaveProperty("fallbacks");
  });

  it("raises a refusal error instead of returning empty text", async () => {
    const create = vi.fn().mockResolvedValue(reply({ stop_reason: "refusal", content: [] }));
    const provider = new AnthropicProvider({ client: { beta: { messages: { create } } } as never });
    await expect(
      provider.complete({
        system: "s",
        messages: [],
        maxTokens: 10,
        task: { kind: "triage", input: triageInput() },
        attempt: 0,
      }),
    ).rejects.toMatchObject({ kind: "refusal" });
  });

  it("requires a key when no client is injected", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow(AiProviderError);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });
});
