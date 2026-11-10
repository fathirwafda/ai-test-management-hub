import type { Attachment, Dashboard, Run, RunDetail, RunItem } from "@hub/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, createProject, startServer, type TestServer } from "./helpers.js";

let s: TestServer;
let projectId: number;

beforeAll(async () => {
  s = await startServer({ maxUploadMb: 1 });
  projectId = (await createProject(s)).id;
  await createCase(s, projectId, { title: "API cart", platform: "API", type: "automated", tags: ["cart"] });
  await createCase(s, projectId, { title: "Web checkout", platform: "Web", tags: ["checkout"] });
  await createCase(s, projectId, { title: "Android login", platform: "Mobile-Android" });
  await createCase(s, projectId, { title: "Old flow", platform: "Web", status: "deprecated" });
  await createCase(s, projectId, { title: "Draft idea", platform: "Web", status: "draft" });
});
afterAll(() => s.close());

const newRun = async (body: Record<string, unknown>) =>
  s.json<Run & { error?: string }>("POST", `/api/projects/${projectId}/runs`, body);
const detail = async (id: number) => (await s.json<RunDetail>("GET", `/api/runs/${id}`)).body;

describe("run creation", () => {
  it("selects cases by filter and never includes deprecated ones", async () => {
    const web = await newRun({ name: "Web only", filter: { platforms: ["Web"] } });
    expect(web.status).toBe(201);
    expect((await detail(web.body.id)).items.map((i) => i.caseTitle).sort()).toEqual(["Draft idea", "Web checkout"]);

    const ready = await newRun({ name: "Ready", filter: { statuses: ["ready"] } });
    expect(ready.body.counts.total).toBe(3);

    const tagged = await newRun({ name: "Tagged", filter: { tags: ["cart"], types: ["automated"] } });
    expect(tagged.body.counts).toMatchObject({ total: 1, untested: 1 });
  });

  it("rejects selections that match nothing", async () => {
    const res = await newRun({ name: "Empty", filter: { platforms: ["Mobile-iOS"] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active test cases/);
  });
});

describe("run lifecycle", () => {
  let run: RunDetail;
  beforeAll(async () => {
    const created = await newRun({
      name: "Release 1.0",
      environment: "staging",
      build: "1.0.0",
      filter: { statuses: ["ready"] },
    });
    run = await detail(created.body.id);
  });

  it("starts with every item untested and no pass rate", () => {
    expect(run).toMatchObject({ status: "open", environment: "staging", build: "1.0.0", passRate: null, progress: 0 });
    expect(run.items.every((i) => i.status === "untested" && i.executedAt === null)).toBe(true);
  });

  it("records results and updates progress and pass rate", async () => {
    const [a, b, c] = run.items;
    const pass = await s.json<RunItem>("PATCH", `/api/run-items/${a!.id}`, {
      status: "passed",
      durationMs: 1500,
      executedBy: "Dana",
    });
    expect(pass.body).toMatchObject({ status: "passed", durationMs: 1500, executedBy: "Dana" });
    expect(pass.body.executedAt).not.toBeNull();
    await s.json("PATCH", `/api/run-items/${b!.id}`, { status: "failed", comment: "Button missing" });
    await s.json("PATCH", `/api/run-items/${c!.id}`, { status: "skipped" });

    const after = await detail(run.id);
    expect(after.counts).toMatchObject({ passed: 1, failed: 1, skipped: 1, untested: 0 });
    expect(after.passRate).toBeCloseTo(0.5);
    expect(after.progress).toBe(1);

    const back = await s.json<RunItem>("PATCH", `/api/run-items/${c!.id}`, { status: "untested" });
    expect(back.body.executedAt).toBeNull();
  });

  it("validates result updates", async () => {
    expect((await s.json("PATCH", `/api/run-items/${run.items[0]!.id}`, { status: "exploded" })).status).toBe(400);
    expect((await s.json("PATCH", `/api/run-items/${run.items[0]!.id}`, { durationMs: -1 })).status).toBe(400);
    expect((await s.json("PATCH", "/api/run-items/99999", { status: "passed" })).status).toBe(404);
  });

  it("stores an accepted triage with who accepted it", async () => {
    const res = await s.json<RunItem>("PATCH", `/api/run-items/${run.items[1]!.id}`, {
      triage: { category: "product_bug", summary: "Checkout button not rendered", acceptedBy: "Dana" },
    });
    expect(res.body.triage).toMatchObject({ category: "product_bug", acceptedBy: "Dana" });
    expect(res.body.triage!.acceptedAt).toBeDefined();
  });

  it("makes a closed run read-only until it is reopened", async () => {
    const closed = await s.json<Run>("POST", `/api/runs/${run.id}/close`);
    expect(closed.body).toMatchObject({ status: "closed" });
    expect(closed.body.closedAt).not.toBeNull();
    expect((await s.json("POST", `/api/runs/${run.id}/close`)).status).toBe(409);
    expect((await s.json("PATCH", `/api/run-items/${run.items[0]!.id}`, { status: "failed" })).status).toBe(409);

    const form = new FormData();
    form.append("files", new Blob(["log"], { type: "text/plain" }), "x.log");
    expect((await s.form(`/api/run-items/${run.items[0]!.id}/attachments`, form)).status).toBe(409);

    expect((await s.json<Run>("POST", `/api/runs/${run.id}/reopen`)).body).toMatchObject({
      status: "open",
      closedAt: null,
    });
    expect((await s.json("PATCH", `/api/run-items/${run.items[0]!.id}`, { status: "passed" })).status).toBe(200);
  });

  it("updates run notes", async () => {
    const res = await s.json<Run>("PATCH", `/api/runs/${run.id}`, { notes: "Ready with one known issue" });
    expect(res.body.notes).toBe("Ready with one known issue");
  });

  it("exports Markdown, HTML and CSV reports", async () => {
    const md = await fetch(`${s.base}/api/runs/${run.id}/report?format=md`);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("# Test run report: Release 1.0");

    const html = await fetch(`${s.base}/api/runs/${run.id}/report?format=html`);
    expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await html.text()).toContain("<!doctype html>");

    const csv = await fetch(`${s.base}/api/runs/${run.id}/report?format=csv`);
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename="test-run-\d+-release-1-0.csv"/);
    expect((await csv.text()).split("\r\n")[0]).toMatch(/^key,title/);

    expect((await fetch(`${s.base}/api/runs/${run.id}/report?format=pdf`)).status).toBe(400);
  });

  it("feeds the dashboard", async () => {
    const d = (await s.json<Dashboard>("GET", `/api/projects/${projectId}/dashboard`)).body;
    expect(d.totals.runs).toBeGreaterThanOrEqual(4);
    expect(d.trend.some((t) => t.runId === run.id)).toBe(true);
    expect(d.coverage.find((c) => c.platform === "API")).toMatchObject({ automated: 1, manual: 0 });
  });
});

describe("evidence", () => {
  let item: RunItem;
  beforeAll(async () => {
    const created = await newRun({ name: "Evidence run", filter: { platforms: ["API"] } });
    item = (await detail(created.body.id)).items[0]!;
  });

  it("uploads several files, detects their kind and lists them on the item", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108020000009077", "hex");
    const form = new FormData();
    form.append("files", new Blob([png], { type: "image/png" }), "screen.png");
    form.append("files", new Blob(['{"log":{"entries":[]}}']), "network.har");
    form.append("files", new Blob(["<svg onload=alert(1)>"], { type: "image/svg+xml" }), "../../evil.svg");
    const res = await s.form<Attachment[]>(`/api/run-items/${item.id}/attachments`, form);
    expect(res.status).toBe(201);
    expect(res.body.map((a) => [a.fileName, a.kind, a.stored])).toEqual([
      ["screen.png", "image", true],
      ["network.har", "text", true],
      ["evil.svg", "file", true],
    ]);
    const after = await s.json<RunItem>("GET", `/api/runs/${item.runId}`);
    expect(JSON.stringify(after.body)).toContain("network.har");
  });

  it("serves previews inline with safe headers and forces download for risky types", async () => {
    const all = (await detail(item.runId)).items.find((i) => i.id === item.id)!.attachments;
    const png = all.find((a) => a.kind === "image")!;
    const har = all.find((a) => a.fileName === "network.har")!;
    const svg = all.find((a) => a.fileName === "evil.svg")!;

    const img = await fetch(`${s.base}/api/attachments/${png.id}/content`);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-disposition")).toMatch(/^inline/);
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");

    const text = await fetch(`${s.base}/api/attachments/${har.id}/content`);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toContain("entries");

    const risky = await fetch(`${s.base}/api/attachments/${svg.id}/content`);
    expect(risky.headers.get("content-type")).toBe("application/octet-stream");
    expect(risky.headers.get("content-disposition")).toMatch(/^attachment/);

    const dl = await fetch(`${s.base}/api/attachments/${png.id}/content?download=1`);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''screen.png/);
  });

  it("rejects files over the size limit and requests without files", async () => {
    const big = new FormData();
    big.append("files", new Blob([Buffer.alloc(1024 * 1024 + 10)]), "big.bin");
    expect((await s.form(`/api/run-items/${item.id}/attachments`, big)).status).toBe(413);
    expect((await s.form(`/api/run-items/${item.id}/attachments`, new FormData())).status).toBe(400);
  });

  it("deletes evidence from the database and the disk", async () => {
    const before = (await detail(item.runId)).items.find((i) => i.id === item.id)!.attachments;
    const target = before[0]!;
    expect((await s.json("DELETE", `/api/attachments/${target.id}`)).status).toBe(204);
    expect((await fetch(`${s.base}/api/attachments/${target.id}/content`)).status).toBe(404);
  });

  it("deletes a run together with its evidence files", async () => {
    const remaining = (await detail(item.runId)).items.find((i) => i.id === item.id)!.attachments;
    expect(remaining.length).toBeGreaterThan(0);
    const fs = await import("node:fs");
    const before = fs.readdirSync(s.deps.evidence.root).length;
    expect((await s.json("DELETE", `/api/runs/${item.runId}`)).status).toBe(204);
    expect(fs.readdirSync(s.deps.evidence.root).length).toBe(before - remaining.length);
  });
});
