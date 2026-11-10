import type { CaseFilter, CaseHistoryEntry, TestCase, TestCaseData, TestCasePatch, TestStep } from "@hub/shared";
import { conflict, notFound } from "../lib/errors.js";
import { normalizeRef, parseJson, type RepoContext } from "./context.js";
import type { ProjectRepo } from "./projects.js";

interface CaseRow {
  id: number;
  project_id: number;
  suite_id: number | null;
  number: number;
  title: string;
  description: string;
  preconditions: string;
  steps: string;
  priority: TestCase["priority"];
  tags: string;
  platform: TestCase["platform"];
  type: TestCase["type"];
  automation_ref: string | null;
  requirement: string;
  status: TestCase["status"];
  source: TestCase["source"];
  needs_review: number;
  created_at: string;
  updated_at: string;
}

export const caseKey = (n: number) => `TC-${n}`;

export const toCase = (r: CaseRow): TestCase => ({
  id: r.id,
  projectId: r.project_id,
  suiteId: r.suite_id,
  key: caseKey(r.number),
  title: r.title,
  description: r.description,
  preconditions: r.preconditions,
  steps: parseJson<TestStep[]>(r.steps, []),
  priority: r.priority,
  tags: parseJson<string[]>(r.tags, []),
  platform: r.platform,
  type: r.type,
  automationRef: r.automation_ref,
  requirement: r.requirement,
  status: r.status,
  source: r.source,
  needsReview: r.needs_review === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const inList = (values: readonly unknown[]) => values.map(() => "?").join(", ");

export class CaseRepo {
  constructor(
    private readonly ctx: RepoContext,
    private readonly projects: ProjectRepo,
  ) {}

  list(projectId: number, filter: CaseFilter = {}): TestCase[] {
    const where = ["c.project_id = ?"];
    const params: unknown[] = [projectId];
    if (filter.suiteId) {
      where.push("c.suite_id = ?");
      params.push(filter.suiteId);
    }
    const lists = [
      ["c.platform", filter.platforms],
      ["c.type", filter.types],
      ["c.status", filter.statuses],
      ["c.priority", filter.priorities],
    ] as const;
    for (const [column, values] of lists) {
      if (values && values.length > 0) {
        where.push(`${column} IN (${inList(values)})`);
        params.push(...values);
      }
    }
    if (filter.tags && filter.tags.length > 0) {
      where.push(`EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value IN (${inList(filter.tags)}))`);
      params.push(...filter.tags);
    }
    if (filter.needsReview !== undefined) {
      where.push("c.needs_review = ?");
      params.push(filter.needsReview ? 1 : 0);
    }
    if (filter.q) {
      const keyMatch = /^tc-(\d+)$/i.exec(filter.q);
      if (keyMatch) {
        where.push("c.number = ?");
        params.push(Number(keyMatch[1]));
      } else {
        where.push(
          "(c.title LIKE ? ESCAPE '\\' OR c.automation_ref LIKE ? ESCAPE '\\' OR c.requirement LIKE ? ESCAPE '\\')",
        );
        const like = `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        params.push(like, like, like);
      }
    }
    const rows = this.ctx.db
      .prepare(`SELECT * FROM test_cases c WHERE ${where.join(" AND ")} ORDER BY c.number`)
      .all(...params) as CaseRow[];
    return rows.map(toCase);
  }

  find(id: number): TestCase | undefined {
    const row = this.ctx.db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as CaseRow | undefined;
    return row && toCase(row);
  }

  get(id: number): TestCase {
    const c = this.find(id);
    if (!c) throw notFound("Test case");
    return c;
  }

  findByNumber(projectId: number, number: number): TestCase | undefined {
    const row = this.ctx.db
      .prepare("SELECT * FROM test_cases WHERE project_id = ? AND number = ?")
      .get(projectId, number) as CaseRow | undefined;
    return row && toCase(row);
  }

  create(projectId: number, data: TestCaseData, options: { needsReview?: boolean } = {}): TestCase {
    return this.ctx.db.transaction(() => {
      const number = this.projects.nextCaseNumber(projectId);
      const now = this.ctx.clock.now();
      const info = this.ctx.db
        .prepare(
          `INSERT INTO test_cases (project_id, suite_id, number, title, description, preconditions, steps, priority,
             tags, platform, type, automation_ref, automation_ref_norm, requirement, status, source, needs_review,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projectId,
          data.suiteId,
          number,
          data.title,
          data.description,
          data.preconditions,
          JSON.stringify(data.steps),
          data.priority,
          JSON.stringify(data.tags),
          data.platform,
          data.type,
          data.automationRef,
          normalizeRef(data.automationRef),
          data.requirement,
          data.status,
          data.source,
          options.needsReview ? 1 : 0,
          now,
          now,
        );
      return this.get(Number(info.lastInsertRowid));
    })();
  }

  update(id: number, patch: TestCasePatch): TestCase {
    const current = this.get(id);
    const next = { ...current, ...patch };
    if (patch.tags) next.tags = [...new Set(patch.tags)];
    if (next.automationRef === "") next.automationRef = null;
    this.ctx.db
      .prepare(
        `UPDATE test_cases SET suite_id = ?, title = ?, description = ?, preconditions = ?, steps = ?, priority = ?,
           tags = ?, platform = ?, type = ?, automation_ref = ?, automation_ref_norm = ?, requirement = ?, status = ?,
           needs_review = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.suiteId,
        next.title,
        next.description,
        next.preconditions,
        JSON.stringify(next.steps),
        next.priority,
        JSON.stringify(next.tags),
        next.platform,
        next.type,
        next.automationRef,
        normalizeRef(next.automationRef),
        next.requirement,
        next.status,
        next.needsReview ? 1 : 0,
        this.ctx.clock.now(),
        id,
      );
    return this.get(id);
  }

  /** Cases with results are kept for history: deprecate them instead. */
  delete(id: number): void {
    this.get(id);
    const used = this.ctx.db.prepare("SELECT COUNT(*) AS n FROM run_items WHERE case_id = ?").get(id) as {
      n: number;
    };
    if (used.n > 0) {
      throw conflict("This case has results in test runs. Set its status to deprecated instead of deleting it.");
    }
    this.ctx.db.prepare("DELETE FROM test_cases WHERE id = ?").run(id);
  }

  tags(projectId: number): string[] {
    return (
      this.ctx.db
        .prepare(
          `SELECT DISTINCT t.value AS tag FROM test_cases c, json_each(c.tags) t WHERE c.project_id = ? ORDER BY tag`,
        )
        .all(projectId) as { tag: string }[]
    ).map((r) => r.tag);
  }

  history(caseId: number): CaseHistoryEntry[] {
    return (
      this.ctx.db
        .prepare(
          `SELECT r.id AS runId, r.name AS runName, i.status, i.executed_at AS executedAt, r.created_at AS createdAt
           FROM run_items i JOIN runs r ON r.id = i.run_id
           WHERE i.case_id = ? ORDER BY r.created_at DESC, r.id DESC`,
        )
        .all(caseId) as CaseHistoryEntry[]
    ).map((h) => ({ ...h }));
  }

  /** Lookup tables used by the results importer. */
  mappingIndex(projectId: number): { byRef: Map<string, number>; byNumber: Map<number, number> } {
    const rows = this.ctx.db
      .prepare("SELECT id, number, automation_ref_norm FROM test_cases WHERE project_id = ?")
      .all(projectId) as { id: number; number: number; automation_ref_norm: string | null }[];
    const byRef = new Map<string, number>();
    const byNumber = new Map<number, number>();
    for (const r of rows) {
      byNumber.set(r.number, r.id);
      if (r.automation_ref_norm && !byRef.has(r.automation_ref_norm)) byRef.set(r.automation_ref_norm, r.id);
    }
    return { byRef, byNumber };
  }
}
