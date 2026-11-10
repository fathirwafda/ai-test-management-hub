import fs from "node:fs";
import { RunInput, RunItemPatch, RunPatch, type Attachment } from "@hub/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attachmentKind, resolveMimeType, safeFileName } from "../lib/evidence-store.js";
import { badRequest, idParam, parse } from "../lib/errors.js";
import { runToCsv, runToHtml, runToMarkdown } from "../reports/run-report.js";
import type { Deps } from "./deps.js";

type Params = { projectId: string; runId: string; itemId: string; attachmentId: string };

const ReportQuery = z.object({
  format: z.enum(["md", "html", "csv"]).default("md"),
  download: z.enum(["0", "1"]).optional(),
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "run";

export function runRoutes(app: FastifyInstance, { store, evidence }: Deps): void {
  app.get<{ Params: Params }>("/api/projects/:projectId/runs", (req) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    return store.runs.list(projectId);
  });

  app.post<{ Params: Params }>("/api/projects/:projectId/runs", async (req, reply) => {
    const projectId = idParam(req.params.projectId);
    store.projects.get(projectId);
    const input = parse(RunInput, req.body);

    let caseIds: number[];
    if (input.caseIds) {
      const cases = input.caseIds.map((id) => store.cases.get(id));
      if (cases.some((c) => c.projectId !== projectId)) throw badRequest("Every case must belong to this project");
      caseIds = cases.filter((c) => c.status !== "deprecated").map((c) => c.id);
    } else {
      caseIds = store.cases
        .list(projectId, input.filter)
        .filter((c) => c.status !== "deprecated")
        .map((c) => c.id);
    }
    if (caseIds.length === 0) throw badRequest("No active test cases match this selection");
    const run = store.runs.create(projectId, input, caseIds);
    return reply.code(201).send(run);
  });

  app.get<{ Params: Params }>("/api/runs/:runId", (req) => store.runs.detail(idParam(req.params.runId)));

  app.patch<{ Params: Params }>("/api/runs/:runId", (req) =>
    store.runs.update(idParam(req.params.runId), parse(RunPatch, req.body)),
  );

  app.post<{ Params: Params }>("/api/runs/:runId/close", (req) =>
    store.runs.setStatus(idParam(req.params.runId), "closed"),
  );
  app.post<{ Params: Params }>("/api/runs/:runId/reopen", (req) =>
    store.runs.setStatus(idParam(req.params.runId), "open"),
  );

  app.delete<{ Params: Params }>("/api/runs/:runId", async (req, reply) => {
    const keys = store.runs.delete(idParam(req.params.runId));
    await Promise.all(keys.map((k) => evidence.remove(k)));
    return reply.code(204).send();
  });

  app.get<{ Params: Params; Querystring: unknown }>("/api/runs/:runId/report", async (req, reply) => {
    const run = store.runs.detail(idParam(req.params.runId));
    const { format, download } = parse(ReportQuery, req.query);
    const name = `test-run-${run.id}-${slug(run.name)}.${format}`;
    const types = {
      md: "text/markdown; charset=utf-8",
      html: "text/html; charset=utf-8",
      csv: "text/csv; charset=utf-8",
    };
    const body = format === "md" ? runToMarkdown(run) : format === "html" ? runToHtml(run) : runToCsv(run);
    reply.header("content-type", types[format]);
    if (format === "html") reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
    if (download === "1" || format === "csv") reply.header("content-disposition", `attachment; filename="${name}"`);
    return reply.send(body);
  });

  // ---------- run items ----------

  app.patch<{ Params: Params }>("/api/run-items/:itemId", (req) =>
    store.runs.patchItem(idParam(req.params.itemId), parse(RunItemPatch, req.body)),
  );

  app.post<{ Params: Params }>("/api/run-items/:itemId/attachments", async (req, reply) => {
    const item = store.runs.getItem(idParam(req.params.itemId));
    store.runs.assertOpen(item.runId);
    if (!req.isMultipart()) throw badRequest("Send the files as multipart/form-data");

    const saved: string[] = [];
    try {
      const created: {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        kind: Attachment["kind"];
        key: string;
      }[] = [];
      for await (const part of req.files()) {
        const data = await part.toBuffer();
        const fileName = safeFileName(part.filename);
        const mimeType = resolveMimeType(fileName, part.mimetype);
        const key = await evidence.save(data, fileName);
        saved.push(key);
        created.push({ fileName, mimeType, sizeBytes: data.length, kind: attachmentKind(fileName, mimeType), key });
      }
      if (created.length === 0) throw badRequest("No files in the request");
      const rows = store.transaction(() =>
        created.map((c) =>
          store.attachments.create({
            runItemId: item.id,
            fileName: c.fileName,
            mimeType: c.mimeType,
            sizeBytes: c.sizeBytes,
            kind: c.kind,
            storageKey: c.key,
            externalPath: null,
          }),
        ),
      );
      return reply.code(201).send(rows);
    } catch (err) {
      await Promise.all(saved.map((k) => evidence.remove(k)));
      throw err;
    }
  });

  app.get<{ Params: Params; Querystring: { download?: string } }>(
    "/api/attachments/:attachmentId/content",
    async (req, reply) => {
      const row = store.attachments.row(idParam(req.params.attachmentId));
      if (!row.storage_key) {
        throw badRequest(
          `This attachment is metadata only (recorded from an imported report): ${row.external_path ?? ""}`,
        );
      }
      const file = evidence.resolve(row.storage_key);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) return reply.code(410).send({ error: "The evidence file is missing on disk" });

      // Only images, video and plain text are shown inline; everything else downloads. The sandbox CSP stops
      // a crafted file from running script even if a browser decides to render it.
      const inline = req.query.download !== "1" && row.kind !== "file";
      const type =
        row.kind === "text"
          ? "text/plain; charset=utf-8"
          : row.kind === "file"
            ? "application/octet-stream"
            : row.mime_type;
      const encoded = encodeURIComponent(row.file_name);
      reply
        .header("content-type", type)
        .header("content-length", stat.size)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
        .header("cache-control", "private, max-age=3600")
        .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`);
      return reply.send(fs.createReadStream(file));
    },
  );

  app.delete<{ Params: Params }>("/api/attachments/:attachmentId", async (req, reply) => {
    const id = idParam(req.params.attachmentId);
    const item = store.runs.getItem(store.attachments.get(id).runItemId);
    store.runs.assertOpen(item.runId);
    const key = store.attachments.delete(id);
    if (key) await evidence.remove(key);
    return reply.code(204).send();
  });
}
