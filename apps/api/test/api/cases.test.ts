import type { Suite, TestCase } from "@hub/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, createProject, createSuite, startServer, type TestServer } from "./helpers.js";

let s: TestServer;
let projectId: number;

beforeAll(async () => {
  s = await startServer();
  projectId = (await createProject(s)).id;
});
afterAll(() => s.close());

describe("projects and suites", () => {
  it("creates and lists projects with counts", async () => {
    const res = await s.json<{ id: number; caseCount: number }[]>("GET", "/api/projects");
    expect(res.status).toBe(200);
    expect(res.body.find((p) => p.id === projectId)).toMatchObject({ caseCount: 0 });
  });

  it("validates project input", async () => {
    const res = await s.json<{ error: string; details: { path: string }[] }>("POST", "/api/projects", { name: "" });
    expect(res.status).toBe(400);
    expect(res.body.details[0]!.path).toBe("name");
  });

  it("rejects duplicate suite names in a project", async () => {
    await createSuite(s, projectId, "Payments");
    const dup = await s.json("POST", `/api/projects/${projectId}/suites`, { name: "Payments" });
    expect(dup.status).toBe(409);
  });

  it("returns 404 for unknown resources and bad ids", async () => {
    expect((await s.json("GET", "/api/projects/9999")).status).toBe(404);
    expect((await s.json("GET", "/api/cases/abc")).status).toBe(400);
    expect((await s.json("GET", "/api/nope")).status).toBe(404);
  });
});

describe("test cases", () => {
  let suite: Suite;
  beforeAll(async () => {
    suite = await createSuite(s, projectId, "Cart");
  });

  it("creates a case with a project-wide key and normalised tags", async () => {
    const c = await createCase(s, projectId, {
      suiteId: suite.id,
      title: "Adds an item to the cart",
      platform: "API",
      type: "automated",
      automationRef: "com.shop.CartTest#addsItem",
      tags: ["Cart", "smoke", "cart"],
      steps: [{ action: "POST /cart/items", expected: "201" }],
      priority: "critical",
    });
    expect(c.key).toMatch(/^TC-\d+$/);
    expect(c).toMatchObject({
      suiteId: suite.id,
      tags: ["cart", "smoke"],
      source: "manual",
      needsReview: false,
      status: "ready",
    });
    const next = await createCase(s, projectId, { title: "Second" });
    expect(Number(next.key.slice(3))).toBe(Number(c.key.slice(3)) + 1);
  });

  it("validates platform, tags and suite ownership", async () => {
    expect((await s.json("POST", `/api/projects/${projectId}/cases`, { title: "x", platform: "Desktop" })).status).toBe(
      400,
    );
    expect(
      (await s.json("POST", `/api/projects/${projectId}/cases`, { title: "x", platform: "Web", tags: ["no spaces"] }))
        .status,
    ).toBe(400);
    const other = await createProject(s, "Other");
    const foreignSuite = await createSuite(s, other.id, "Foreign");
    expect(
      (
        await s.json("POST", `/api/projects/${projectId}/cases`, {
          title: "x",
          platform: "Web",
          suiteId: foreignSuite.id,
        })
      ).status,
    ).toBe(404);
  });

  it("filters by platform, type, status, tag, suite and search", async () => {
    await createCase(s, projectId, { title: "iOS sign in", platform: "Mobile-iOS", tags: ["auth"], status: "draft" });
    const list = async (q: string) => (await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases${q}`)).body;
    expect((await list("?platforms=Mobile-iOS")).map((c) => c.title)).toEqual(["iOS sign in"]);
    expect((await list("?types=automated")).every((c) => c.type === "automated")).toBe(true);
    expect((await list("?tags=auth,smoke")).map((c) => c.title).sort()).toEqual([
      "Adds an item to the cart",
      "iOS sign in",
    ]);
    expect((await list(`?suiteId=${suite.id}`)).map((c) => c.title)).toEqual(["Adds an item to the cart"]);
    expect((await list("?statuses=draft")).map((c) => c.title)).toEqual(["iOS sign in"]);
    expect((await list("?q=cart")).map((c) => c.title)).toEqual(["Adds an item to the cart"]);
    expect((await list("?q=100%25")).length).toBe(0); // LIKE wildcards are escaped
    const first = (await list(""))[0]!;
    expect((await list(`?q=${first.key.toLowerCase()}`)).map((c) => c.id)).toEqual([first.id]);
    expect((await s.json("GET", `/api/projects/${projectId}/cases?platforms=Nope`)).status).toBe(400);
  });

  it("updates a case, including clearing the review flag", async () => {
    const c = await createCase(s, projectId, { title: "Old title" });
    const res = await s.json<TestCase>("PATCH", `/api/cases/${c.id}`, {
      title: "New title",
      type: "automated",
      automationRef: "a#b",
      needsReview: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "New title", automationRef: "a#b" });
    expect(res.body.updatedAt >= c.updatedAt).toBe(true);
  });

  it("bulk-creates cases in one transaction", async () => {
    const ok = await s.json<TestCase[]>("POST", `/api/projects/${projectId}/cases/bulk`, {
      cases: [
        { title: "AI one", platform: "Web", source: "ai" },
        { title: "AI two", platform: "API", source: "ai" },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.map((c) => c.source)).toEqual(["ai", "ai"]);
    const before = (await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases`)).body.length;
    const bad = await s.json("POST", `/api/projects/${projectId}/cases/bulk`, {
      cases: [{ title: "fine", platform: "Web" }, { title: "" }],
    });
    expect(bad.status).toBe(400);
    expect((await s.json<TestCase[]>("GET", `/api/projects/${projectId}/cases`)).body.length).toBe(before);
  });

  it("deletes unused cases but keeps cases that have results", async () => {
    const unused = await createCase(s, projectId, { title: "Throwaway" });
    expect((await s.json("DELETE", `/api/cases/${unused.id}`)).status).toBe(204);
    expect((await s.json("GET", `/api/cases/${unused.id}`)).status).toBe(404);

    const used = await createCase(s, projectId, { title: "Has history" });
    await s.json("POST", `/api/projects/${projectId}/runs`, { name: "r", caseIds: [used.id] });
    const res = await s.json<{ error: string }>("DELETE", `/api/cases/${used.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/deprecated/);
  });

  it("lists the project's tags", async () => {
    const tags = (await s.json<string[]>("GET", `/api/projects/${projectId}/tags`)).body;
    expect(tags).toEqual(expect.arrayContaining(["auth", "cart", "smoke"]));
  });
});

describe("OpenAPI", () => {
  it("serves a document built from the request schemas", async () => {
    const res = await s.json<{ openapi: string; paths: Record<string, Record<string, { requestBody?: unknown }>> }>(
      "GET",
      "/api/openapi.json",
    );
    expect(res.body.openapi).toBe("3.1.0");
    expect(res.body.paths["/api/projects/{projectId}/cases"]!.post!.requestBody).toBeDefined();
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(20);
  });
});
