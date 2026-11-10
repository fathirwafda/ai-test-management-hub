import { ProjectInput, SuiteInput } from "@hub/shared";
import type { FastifyInstance } from "fastify";
import { idParam, parse } from "../lib/errors.js";
import { computeDashboard } from "../stats/dashboard.js";
import type { Deps } from "./deps.js";

type Params = { projectId: string; suiteId: string };

export function projectRoutes(app: FastifyInstance, { store }: Deps): void {
  app.get("/api/projects", () => store.projects.list());

  app.post("/api/projects", async (req, reply) => {
    const project = store.projects.create(parse(ProjectInput, req.body));
    return reply.code(201).send(project);
  });

  app.get<{ Params: Params }>("/api/projects/:projectId", (req) => store.projects.get(idParam(req.params.projectId)));

  app.patch<{ Params: Params }>("/api/projects/:projectId", (req) =>
    store.projects.update(idParam(req.params.projectId), parse(ProjectInput.partial(), req.body)),
  );

  app.get<{ Params: Params }>("/api/projects/:projectId/suites", (req) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return store.suites.list(projectId);
  });

  app.post<{ Params: Params }>("/api/projects/:projectId/suites", async (req, reply) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return reply.code(201).send(store.suites.create(projectId, parse(SuiteInput, req.body)));
  });

  app.patch<{ Params: Params }>("/api/suites/:suiteId", (req) =>
    store.suites.update(idParam(req.params.suiteId), parse(SuiteInput.partial(), req.body)),
  );

  app.delete<{ Params: Params }>("/api/suites/:suiteId", async (req, reply) => {
    store.suites.delete(idParam(req.params.suiteId));
    return reply.code(204).send();
  });

  app.get<{ Params: Params }>("/api/projects/:projectId/tags", (req) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return store.cases.tags(projectId);
  });

  app.get<{ Params: Params }>("/api/projects/:projectId/dashboard", (req) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return computeDashboard({
      cases: store.cases.list(projectId),
      runs: store.runs.list(projectId),
      results: store.runs.resultsForProject(projectId),
    });
  });
}
