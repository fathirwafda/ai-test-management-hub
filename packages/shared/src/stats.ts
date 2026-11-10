import type { CaseStatus, CaseType, Platform, ResultStatus, RunCounts } from "./domain.js";

export interface CoverageRow {
  platform: Platform;
  automated: number;
  manual: number;
  /** automated / (automated + manual), 0..1; null when the platform has no active cases. */
  automationRate: number | null;
}

export interface TrendPoint {
  runId: number;
  name: string;
  createdAt: string;
  passRate: number | null;
  executed: number;
  total: number;
}

export interface FlakyCandidate {
  caseId: number;
  key: string;
  title: string;
  platform: Platform;
  flips: number;
  /** Oldest first, only runs where the case was passed or failed. */
  history: ("passed" | "failed")[];
}

export interface Dashboard {
  totals: {
    cases: number;
    activeCases: number;
    runs: number;
    needsReview: number;
    byPlatform: Record<Platform, number>;
    byType: Record<CaseType, number>;
    byStatus: Record<CaseStatus, number>;
  };
  coverage: CoverageRow[];
  overallAutomationRate: number | null;
  trend: TrendPoint[];
  flaky: FlakyCandidate[];
  latestRun: { id: number; name: string; counts: RunCounts; passRate: number | null } | null;
}

/** Counts results that were actually executed (skipped and untested are not). */
export function passRate(counts: Pick<RunCounts, "passed" | "failed" | "blocked" | "retest">): number | null {
  const executed = counts.passed + counts.failed + counts.blocked + counts.retest;
  return executed === 0 ? null : counts.passed / executed;
}

export function emptyCounts(): RunCounts {
  return { total: 0, untested: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0 };
}

export function countStatuses(statuses: Iterable<ResultStatus>): RunCounts {
  const counts = emptyCounts();
  for (const s of statuses) {
    counts.total += 1;
    counts[s] += 1;
  }
  return counts;
}

export function progress(counts: RunCounts): number {
  return counts.total === 0 ? 0 : (counts.total - counts.untested) / counts.total;
}

export function formatPercent(value: number | null, digits = 0): string {
  return value === null ? "–" : `${(value * 100).toFixed(digits)}%`;
}
