import type { ImportSummary, RunDetail, TestCase } from "@hub/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, createProject, createSuite, fixture, startServer, type TestServer } from "./helpers.js";

let s: TestServer;
let projectId: number;
let cartCase: TestCase;
let keyed: TestCase;

beforeAll(async () => {
  s = await startServer();
  projectId = (await createProject(s)).id;
  cartCase = await createCase(s, projectId, {
    title: "Adds an item and recalculates the total",
    platform: "API",
    type: "automated",
    automationRef: "com.larkspur.api.CartApiTest#addsItemAndRecalculatesTotal",
  });
  await createCase(s, projectId, {
    title: "Rejects an expired code",
    platform: "API",
    type: "automated",
    automationRef: "com.larkspur.api.CartApiTest#rejectsExpiredDiscountCode",
  });
  keyed = await createCase(s, projectId, { title: "Manual case linked by key", platform: "Web" });
});
afterAll(() => s.close());

function upload(name: string, content: Buffer | string, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([content]), name);
  return s.form<ImportSummary & { error?: string }>(`/api/projects/${projectId}/imports`, form);
}

describe("results import", () => {
  it("imports a Surefire report: maps known refs, creates flagged draft cases for the rest", async () => {
    const suite = await createSuite(s, projectId, "Imported");
    const res = await upload("TEST-results.xml", fixture("junit-surefire-restassured.xml"), {
      runName: "API regression",
      environment: "staging",
      build: "abc1234",
      platform: "API",
      suiteId: String(suite.id),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      format: "junit",
      total: 6,
      mapped: 2,
      created: 4,
      results: { passed: 3, failed: 2, skipped: 1, blocked: 0, retest: 0 },
    });
    expect(res.body.warnings.join(" ")).toMatch(/needs review/);

    const run = (await s.json<RunDetail>("GET", `/api/runs/${res.body.runId}`)).body;
    expect(run).toMatchObject({ name: "API regression", environment: "staging", build: "abc1234", source: "import" });
    const mapped = run.items.find((i) => i.caseId === cartCase.id)!;
    expect(mapped).toMatchObject({ status: "passed", durationMs: 931, executedBy: "ci" });
    const failed = run.items.find((i) => i.automationRef?.endsWith("#rejectsExpiredDiscountCode"))!;
    expect(failed.failureMessage).toContain("Expected status code <422> but was <200>.");

    const created = await s.json<TestCase>("GET", `/api/cases/${res.body.createdCases[0]!.id}`);
    expect(created.body).toMatchObject({
      status: "draft",
      type: "automated",
      source: "import",
      needsReview: true,
      platform: "API",
      suiteId: suite.id,
    });
  });

  it("maps to the same cases on a second import instead of duplicating them", async () => {
    const res = await upload("again.xml", fixture("junit-surefire-restassured.xml"));
    expect(res.body).toMatchObject({ mapped: 6, created: 0 });
  });

  it("imports a Playwright JSON report with attachment metadata and links by case key", async () => {
    const report = fixture("playwright-report.json")
      .toString()
      .replace("saves the cart for later [TC-14]", `saves the cart for later [${keyed.key}]`);
    const res = await upload("report.json", report, { platform: "Web" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ format: "playwright", total: 4, mapped: 1, created: 3 });

    const run = (await s.json<RunDetail>("GET", `/api/runs/${res.body.runId}`)).body;
    expect(run.items.find((i) => i.caseId === keyed.id)!.status).toBe("skipped");
    const failed = run.items.find((i) => i.status === "failed")!;
    expect(failed.attachments.map((a) => [a.stored, a.externalPath])).toEqual([
      [false, "/repo/test-results/checkout-expired-chromium/test-failed-1.png"],
      [false, "/repo/test-results/checkout-expired-chromium/trace.zip"],
    ]);
    const flaky = run.items.find((i) => i.caseTitle.includes("adds a product"))!;
    expect(flaky).toMatchObject({ status: "passed" });
    expect(flaky.comment).toMatch(/flaky/);

    const meta = await fetch(`${s.base}/api/attachments/${failed.attachments[0]!.id}/content`);
    expect(meta.status).toBe(400);
  });

  it("adds results to an existing open run, and refuses a closed one", async () => {
    const run = await s.json<{ id: number }>("POST", `/api/projects/${projectId}/runs`, {
      name: "Manual + auto",
      caseIds: [keyed.id],
    });
    const res = await upload("pytest.xml", fixture("junit-pytest.xml"), { runId: String(run.body.id) });
    expect(res.status).toBe(201);
    expect(res.body.runId).toBe(run.body.id);
    const detail = (await s.json<RunDetail>("GET", `/api/runs/${run.body.id}`)).body;
    expect(detail.counts.total).toBe(4);

    await s.json("POST", `/api/runs/${run.body.id}/close`);
    expect((await upload("pytest.xml", fixture("junit-pytest.xml"), { runId: String(run.body.id) })).status).toBe(409);
  });

  it("rejects bad input without changing anything", async () => {
    const before = (await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases`)).body.length;
    expect((await upload("x.txt", "hello world")).body.error).toMatch(/Unrecognised file/);
    expect((await upload("x.xml", "<testsuites><testcase></testsuites>")).status).toBe(400);
    expect((await upload("x.xml", "<testsuites></testsuites>")).body.error).toMatch(/no test cases/);
    expect((await upload("x.json", fixture("playwright-report.json"), { format: "junit" })).status).toBe(400);
    expect((await upload("x.xml", fixture("junit-pytest.xml"), { platform: "Desktop" })).status).toBe(400);
    expect((await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases`)).body.length).toBe(before);

    const noFile = new FormData();
    noFile.append("runName", "x");
    expect((await s.form(`/api/projects/${projectId}/imports`, noFile)).status).toBe(400);
    expect((await s.json("POST", `/api/projects/${projectId}/imports`, {})).status).toBe(400);
  });
});
