import {
  CASE_STATUSES,
  CASE_TYPES,
  PLATFORMS,
  type CaseStatus,
  type CaseType,
  type CoverageRow,
  type Dashboard,
  type FlakyCandidate,
  type Platform,
  type ResultStatus,
  type Run,
  type TestCase,
  type TrendPoint,
} from "@hub/shared";

export interface DashboardInput {
  cases: Pick<TestCase, "id" | "key" | "title" | "platform" | "type" | "status" | "needsReview">[];
  /** Newest first, as returned by RunRepo.list. */
  runs: Pick<Run, "id" | "name" | "createdAt" | "counts" | "passRate">[];
  /** Oldest run first. */
  results: { runId: number; caseId: number; status: ResultStatus }[];
}

export const TREND_RUNS = 10;
export const FLAKY_WINDOW = 10;
export const FLAKY_MIN_FLIPS = 2;

const zeroes = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Number of pass<->fail transitions in a sequence. */
export function countFlips(history: readonly ("passed" | "failed")[]): number {
  let flips = 0;
  for (let i = 1; i < history.length; i++) if (history[i] !== history[i - 1]) flips++;
  return flips;
}

/**
 * Flaky candidates: cases whose result flipped between passed and failed at least `minFlips` times across the
 * last `window` runs they took part in. One flip is a regression or a fix; two or more is a pattern worth
 * a look. Blocked, skipped, retest and untested results are ignored.
 */
export function flakyCandidates(
  input: Pick<DashboardInput, "cases" | "results">,
  window = FLAKY_WINDOW,
  minFlips = FLAKY_MIN_FLIPS,
): FlakyCandidate[] {
  const histories = new Map<number, ("passed" | "failed")[]>();
  for (const r of input.results) {
    if (r.status !== "passed" && r.status !== "failed") continue;
    const h = histories.get(r.caseId) ?? [];
    h.push(r.status);
    histories.set(r.caseId, h);
  }
  const byId = new Map(input.cases.map((c) => [c.id, c]));
  const out: FlakyCandidate[] = [];
  for (const [caseId, full] of histories) {
    const history = full.slice(-window);
    const flips = countFlips(history);
    const c = byId.get(caseId);
    if (c && flips >= minFlips) {
      out.push({ caseId, key: c.key, title: c.title, platform: c.platform, flips, history });
    }
  }
  return out.sort((a, b) => b.flips - a.flips || a.caseId - b.caseId);
}

export function coverage(cases: DashboardInput["cases"]): CoverageRow[] {
  return PLATFORMS.map((platform) => {
    const active = cases.filter((c) => c.platform === platform && c.status !== "deprecated");
    const automated = active.filter((c) => c.type === "automated").length;
    const manual = active.length - automated;
    return { platform, automated, manual, automationRate: active.length ? automated / active.length : null };
  });
}

export function computeDashboard(input: DashboardInput): Dashboard {
  const byPlatform = zeroes<Platform>(PLATFORMS);
  const byType = zeroes<CaseType>(CASE_TYPES);
  const byStatus = zeroes<CaseStatus>(CASE_STATUSES);
  for (const c of input.cases) {
    byPlatform[c.platform] += 1;
    byType[c.type] += 1;
    byStatus[c.status] += 1;
  }
  const active = input.cases.filter((c) => c.status !== "deprecated");
  const automated = active.filter((c) => c.type === "automated").length;

  const trend: TrendPoint[] = input.runs
    .slice(0, TREND_RUNS)
    .reverse()
    .map((r) => ({
      runId: r.id,
      name: r.name,
      createdAt: r.createdAt,
      passRate: r.passRate,
      executed: r.counts.total - r.counts.untested,
      total: r.counts.total,
    }));

  const latest = input.runs[0];
  return {
    totals: {
      cases: input.cases.length,
      activeCases: active.length,
      runs: input.runs.length,
      needsReview: input.cases.filter((c) => c.needsReview).length,
      byPlatform,
      byType,
      byStatus,
    },
    coverage: coverage(input.cases),
    overallAutomationRate: active.length ? automated / active.length : null,
    trend,
    flaky: flakyCandidates(input),
    latestRun: latest ? { id: latest.id, name: latest.name, counts: latest.counts, passRate: latest.passRate } : null,
  };
}
