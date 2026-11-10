import type { Project, ProjectInput, Suite, SuiteInput } from "@hub/shared";
import { conflict, notFound } from "../lib/errors.js";
import type { RepoContext } from "./context.js";

interface ProjectRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  case_count: number;
  run_count: number;
}

interface SuiteRow {
  id: number;
  project_id: number;
  name: string;
  description: string;
  case_count: number;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  caseCount: r.case_count,
  runCount: r.run_count,
});

const toSuite = (r: SuiteRow): Suite => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  caseCount: r.case_count,
});

const PROJECT_SELECT = `
  SELECT p.id, p.name, p.description, p.created_at,
    (SELECT COUNT(*) FROM test_cases c WHERE c.project_id = p.id) AS case_count,
    (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count
  FROM projects p`;

export class ProjectRepo {
  constructor(private readonly ctx: RepoContext) {}

  list(): Project[] {
    return (this.ctx.db.prepare(`${PROJECT_SELECT} ORDER BY p.id`).all() as ProjectRow[]).map(toProject);
  }

  find(id: number): Project | undefined {
    const row = this.ctx.db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) as ProjectRow | undefined;
    return row && toProject(row);
  }

  get(id: number): Project {
    const p = this.find(id);
    if (!p) throw notFound("Project");
    return p;
  }

  create(input: Required<ProjectInput>): Project {
    const info = this.ctx.db
      .prepare("INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)")
      .run(input.name, input.description, this.ctx.clock.now());
    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, input: Partial<ProjectInput>): Project {
    const current = this.get(id);
    this.ctx.db
      .prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?")
      .run(input.name ?? current.name, input.description ?? current.description, id);
    return this.get(id);
  }

  /** Reserves the next TC-n number for a project. Call inside the transaction that inserts the case. */
  nextCaseNumber(projectId: number): number {
    const row = this.ctx.db
      .prepare("UPDATE projects SET next_case_number = next_case_number + 1 WHERE id = ? RETURNING next_case_number")
      .get(projectId) as { next_case_number: number } | undefined;
    if (!row) throw notFound("Project");
    return row.next_case_number - 1;
  }
}

const SUITE_SELECT = `
  SELECT s.id, s.project_id, s.name, s.description,
    (SELECT COUNT(*) FROM test_cases c WHERE c.suite_id = s.id) AS case_count
  FROM suites s`;

export class SuiteRepo {
  constructor(private readonly ctx: RepoContext) {}

  list(projectId: number): Suite[] {
    return (
      this.ctx.db.prepare(`${SUITE_SELECT} WHERE s.project_id = ? ORDER BY s.name`).all(projectId) as SuiteRow[]
    ).map(toSuite);
  }

  get(id: number): Suite {
    const row = this.ctx.db.prepare(`${SUITE_SELECT} WHERE s.id = ?`).get(id) as SuiteRow | undefined;
    if (!row) throw notFound("Suite");
    return toSuite(row);
  }

  /** Throws unless the suite exists and belongs to the project. */
  assertInProject(suiteId: number, projectId: number): void {
    if (this.get(suiteId).projectId !== projectId) throw notFound("Suite");
  }

  findByName(projectId: number, name: string): Suite | undefined {
    const row = this.ctx.db.prepare(`${SUITE_SELECT} WHERE s.project_id = ? AND s.name = ?`).get(projectId, name) as
      SuiteRow | undefined;
    return row && toSuite(row);
  }

  create(projectId: number, input: Required<SuiteInput>): Suite {
    if (this.findByName(projectId, input.name)) throw conflict(`A suite named "${input.name}" already exists`);
    const info = this.ctx.db
      .prepare("INSERT INTO suites (project_id, name, description, created_at) VALUES (?, ?, ?, ?)")
      .run(projectId, input.name, input.description, this.ctx.clock.now());
    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, input: Partial<SuiteInput>): Suite {
    const current = this.get(id);
    if (input.name && input.name !== current.name && this.findByName(current.projectId, input.name)) {
      throw conflict(`A suite named "${input.name}" already exists`);
    }
    this.ctx.db
      .prepare("UPDATE suites SET name = ?, description = ? WHERE id = ?")
      .run(input.name ?? current.name, input.description ?? current.description, id);
    return this.get(id);
  }

  /** Cases in the suite are kept and become unassigned. */
  delete(id: number): void {
    this.get(id);
    this.ctx.db.prepare("DELETE FROM suites WHERE id = ?").run(id);
  }
}
