import { countStatuses, passRate, progress } from "@hub/shared";
import { describe, expect, it } from "vitest";
import {
  computeDashboard,
  countFlips,
  coverage,
  flakyCandidates,
  type DashboardInput,
} from "../../src/stats/dashboard.js";

type C = DashboardInput["cases"][number];
const tc = (id: number, over: Partial<C> = {}): C => ({
  id,
  key: `TC-${id}`,
  title: `Case ${id}`,
  platform: "API",
  type: "automated",
  status: "ready",
  needsReview: false,
  ...over,
});

describe("pass rate and progress", () => {
  it("excludes skipped and untested from the pass rate", () => {
    const counts = countStatuses(["passed", "passed", "failed", "skipped", "untested", "blocked"]);
    expect(counts).toMatchObject({ total: 6, passed: 2, failed: 1, skipped: 1, untested: 1, blocked: 1 });
    expect(passRate(counts)).toBeCloseTo(2 / 4);
    expect(progress(counts)).toBeCloseTo(5 / 6);
  });

  it("returns null when nothing was executed", () => {
    expect(passRate(countStatuses(["skipped", "untested"]))).toBeNull();
    expect(progress(countStatuses([]))).toBe(0);
  });
});

describe("flaky candidates", () => {
  it("counts pass/fail transitions", () => {
    expect(countFlips(["passed", "failed", "passed"])).toBe(2);
    expect(countFlips(["passed", "passed", "failed", "failed"])).toBe(1);
    expect(countFlips([])).toBe(0);
  });

  it("lists cases with two or more flips, ignoring non pass/fail results", () => {
    const cases = [tc(1), tc(2), tc(3)];
    const results = [
      // case 1 flips twice -> candidate
      { runId: 1, caseId: 1, status: "passed" as const },
      { runId: 2, caseId: 1, status: "failed" as const },
      { runId: 3, caseId: 1, status: "blocked" as const },
      { runId: 4, caseId: 1, status: "passed" as const },
      // case 2 regressed once -> not a candidate
      { runId: 1, caseId: 2, status: "passed" as const },
      { runId: 2, caseId: 2, status: "failed" as const },
      { runId: 3, caseId: 2, status: "failed" as const },
      // case 3 only skipped
      { runId: 1, caseId: 3, status: "skipped" as const },
    ];
    const flaky = flakyCandidates({ cases, results });
    expect(flaky).toEqual([
      { caseId: 1, key: "TC-1", title: "Case 1", platform: "API", flips: 2, history: ["passed", "failed", "passed"] },
    ]);
  });

  it("only looks at the most recent window", () => {
    const results = ["passed", "failed", "passed", "passed", "passed"].map((status, i) => ({
      runId: i,
      caseId: 1,
      status: status as "passed" | "failed",
    }));
    expect(flakyCandidates({ cases: [tc(1)], results }, 3)).toEqual([]);
    expect(flakyCandidates({ cases: [tc(1)], results }, 5)).toHaveLength(1);
  });
});

describe("coverage and dashboard", () => {
  const cases = [
    tc(1),
    tc(2, { type: "manual" }),
    tc(3, { platform: "Web" }),
    tc(4, { platform: "Web", status: "deprecated", type: "manual" }),
    tc(5, { platform: "Mobile-iOS", type: "manual", needsReview: true, status: "draft" }),
  ];

  it("computes automation coverage per platform from active cases", () => {
    const rows = Object.fromEntries(coverage(cases).map((r) => [r.platform, r]));
    expect(rows.API).toMatchObject({ automated: 1, manual: 1, automationRate: 0.5 });
    expect(rows.Web).toMatchObject({ automated: 1, manual: 0, automationRate: 1 });
    expect(rows["Mobile-Android"]!.automationRate).toBeNull();
  });

  it("builds totals, a chronological trend and the latest run", () => {
    const counts = countStatuses(["passed", "failed"]);
    const runs = [
      { id: 2, name: "new", createdAt: "2026-11-02T00:00:00Z", counts, passRate: 0.5 },
      { id: 1, name: "old", createdAt: "2026-11-01T00:00:00Z", counts: countStatuses(["passed"]), passRate: 1 },
    ];
    const d = computeDashboard({ cases, runs, results: [] });
    expect(d.totals).toMatchObject({ cases: 5, activeCases: 4, runs: 2, needsReview: 1 });
    expect(d.totals.byPlatform).toEqual({ API: 2, Web: 2, "Mobile-Android": 0, "Mobile-iOS": 1 });
    expect(d.totals.byStatus).toEqual({ draft: 1, ready: 3, deprecated: 1 });
    expect(d.overallAutomationRate).toBeCloseTo(2 / 4);
    expect(d.trend.map((t) => t.name)).toEqual(["old", "new"]);
    expect(d.latestRun).toMatchObject({ id: 2, passRate: 0.5 });
  });
});
