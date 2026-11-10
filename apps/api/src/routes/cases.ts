import { CaseFilter, TestCaseInput, TestCasePatch } from "@hub/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParam, parse } from "../lib/errors.js";
import type { Deps } from "./deps.js";

type Params = { projectId: string; caseId: string };

const BulkInput = z.object({ cases: z.array(z.unknown()).min(1).max(50) });

export function caseRoutes(app: FastifyInstance, { store }: Deps): void {
  const assertSuite = (suiteId: number | null | undefined, projectId: number) => {
    if (suiteId) store.suites.assertInProject(suiteId, projectId);
  };

  app.get<{ Params: Params }>("/api/projects/:projectId/cases", (req) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return store.cases.list(projectId, parse(CaseFilter, req.query));
  });

  app.post<{ Params: Params }>("/api/projects/:projectId/cases", async (req, reply) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    const data = parse(TestCaseInput, req.body);
    assertSuite(data.suiteId, projectId);
    return reply.code(201).send(store.cases.create(projectId, data));
  });

  /** Saves several cases at once, e.g. the AI suggestions a reviewer accepted. All or nothing. */
  app.post<{ Params: Params }>("/api/projects/:projectId/cases/bulk", async (req, reply) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    const { cases } = parse(BulkInput, req.body);
    const parsed = cases.map((c) => parse(TestCaseInput, c));
    for (const c of parsed) assertSuite(c.suiteId, projectId);
    const created = store.transaction(() => parsed.map((c) => store.cases.create(projectId, c)));
    return reply.code(201).send(created);
  });

  app.get<{ Params: Params }>("/api/cases/:caseId", (req) => store.cases.get(idParam(req.params.caseId)));

  app.patch<{ Params: Params }>("/api/cases/:caseId", (req) => {
    const id = idParam(req.params.caseId);
    const patch = parse(TestCasePatch, req.body);
    assertSuite(patch.suiteId, store.cases.get(id).projectId);
    return store.cases.update(id, patch);
  });

  app.delete<{ Params: Params }>("/api/cases/:caseId", async (req, reply) => {
    store.cases.delete(idParam(req.params.caseId));
    return reply.code(204).send();
  });

  app.get<{ Params: Params }>("/api/cases/:caseId/history", (req) => {
    const id = idParam(req.params.caseId);
    store.cases.get(id);
    return store.cases.history(id);
  });
}
