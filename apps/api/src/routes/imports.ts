import type { FastifyInstance } from "fastify";
import { badRequest, idParam } from "../lib/errors.js";
import { importResults } from "../importers/service.js";
import type { Deps } from "./deps.js";

const BYTE_ORDER_MARK = 0xfeff;

/**
 * POST /api/projects/:projectId/imports (multipart/form-data)
 *   file         JUnit XML or Playwright JSON report (required)
 *   format       auto | junit | playwright (default auto)
 *   runId        import into an existing open run, or
 *   runName, environment, build   to create a new run
 *   platform     platform for cases created from unmatched results (default API)
 *   suiteId      suite for created cases
 *   executedBy   recorded on each result (default "ci")
 */
export function importRoutes(app: FastifyInstance, { store }: Deps): void {
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/imports", async (req, reply) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    if (!req.isMultipart()) throw badRequest("Send the report as multipart/form-data with a `file` field");

    const fields: Record<string, string> = {};
    let content: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || content !== null) {
          await part.toBuffer();
          throw badRequest("Send exactly one file, in the `file` field");
        }
        content = (await part.toBuffer()).toString("utf8");
        if (content.charCodeAt(0) === BYTE_ORDER_MARK) content = content.slice(1);
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
    if (content === null || content.trim() === "") throw badRequest("The `file` field is missing or empty");

    const options = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
    const summary = importResults(store, projectId, content, options);
    return reply.code(201).send(summary);
  });
}
