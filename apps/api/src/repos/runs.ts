import {
  countStatuses,
  passRate,
  progress,
  type Attachment,
  type ResultStatus,
  type Run,
  type RunCounts,
  type RunDetail,
  type RunItem,
  type RunItemPatch,
  type RunPatch,
  type SavedTriage,
} from "@hub/shared";
import { conflict, notFound } from "../lib/errors.js";
import { caseKey } from "./cases.js";
import { parseJson, type RepoContext } from "./context.js";

interface RunRow {
  id: number;
  project_id: number;
  name: string;
  environment: string;
  build: string;
  status: Run["status"];
  source: Run["source"];
  notes: string;
  created_at: string;
  closed_at: string | null;
}

interface ItemRow {
  id: number;
  run_id: number;
  case_id: number;
  status: ResultStatus;
  comment: string;
  duration_ms: number | null;
  executed_by: string;
  executed_at: string | null;
  failure_message: string;
  failure_details: string;
  triage: string | null;
  number: number;
  title: string;
  platform: RunItem["platform"];
  type: RunItem["type"];
  priority: RunItem["priority"];
  automation_ref: string | null;
}

export interface AttachmentRow {
  id: number;
  run_item_id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: Attachment["kind"];
  storage_key: string | null;
  external_path: string | null;
  created_at: string;
}

export const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  runItemId: r.run_item_id,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  kind: r.kind,
  stored: r.storage_key !== null,
  externalPath: r.external_path,
  createdAt: r.created_at,
});

const ITEM_SELECT = `
  SELECT i.*, c.number, c.title, c.platform, c.type, c.priority, c.automation_ref
  FROM run_items i JOIN test_cases c ON c.id = i.case_id`;

export interface ItemResultUpdate {
  status: ResultStatus;
  durationMs?: number | null;
  executedBy?: string;
  comment?: string;
  failureMessage?: string;
  failureDetails?: string;
}

export class RunRepo {
  constructor(private readonly ctx: RepoContext) {}

  private counts(runIds: number[]): Map<number, RunCounts> {
    const map = new Map<number, RunCounts>();
    if (runIds.length === 0) return map;
    const rows = this.ctx.db
      .prepare(`SELECT run_id, status FROM run_items WHERE run_id IN (${runIds.map(() => "?").join(",")})`)
      .all(...runIds) as { run_id: number; status: ResultStatus }[];
    const grouped = new Map<number, ResultStatus[]>();
    for (const r of rows) grouped.set(r.run_id, [...(grouped.get(r.run_id) ?? []), r.status]);
    for (const id of runIds) map.set(id, countStatuses(grouped.get(id) ?? []));
    return map;
  }

  private toRun(row: RunRow, counts: RunCounts): Run {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      environment: row.environment,
      build: row.build,
      status: row.status,
      source: row.source,
      notes: row.notes,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      counts,
      passRate: passRate(counts),
      progress: progress(counts),
    };
  }

  /** Newest first. */
  list(projectId: number, limit = 200): Run[] {
    const rows = this.ctx.db
      .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(projectId, limit) as RunRow[];
    const counts = this.counts(rows.map((r) => r.id));
    return rows.map((r) => this.toRun(r, counts.get(r.id) ?? countStatuses([])));
  }

  get(id: number): Run {
    const row = this.ctx.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!row) throw notFound("Test run");
    return this.toRun(row, this.counts([id]).get(id) ?? countStatuses([]));
  }

  detail(id: number): RunDetail {
    const run = this.get(id);
    const items = this.ctx.db.prepare(`${ITEM_SELECT} WHERE i.run_id = ? ORDER BY c.number`).all(id) as ItemRow[];
    const attachments = this.ctx.db
      .prepare(
        `SELECT a.* FROM attachments a JOIN run_items i ON i.id = a.run_item_id WHERE i.run_id = ? ORDER BY a.id`,
      )
      .all(id) as AttachmentRow[];
    const byItem = new Map<number, Attachment[]>();
    for (const a of attachments) byItem.set(a.run_item_id, [...(byItem.get(a.run_item_id) ?? []), toAttachment(a)]);
    return { ...run, items: items.map((r) => this.toItem(r, byItem.get(r.id) ?? [])) };
  }

  private toItem(r: ItemRow, attachments: Attachment[]): RunItem {
    return {
      id: r.id,
      runId: r.run_id,
      caseId: r.case_id,
      caseKey: caseKey(r.number),
      caseTitle: r.title,
      platform: r.platform,
      type: r.type,
      priority: r.priority,
      automationRef: r.automation_ref,
      status: r.status,
      comment: r.comment,
      durationMs: r.duration_ms,
      executedBy: r.executed_by,
      executedAt: r.executed_at,
      failureMessage: r.failure_message,
      failureDetails: r.failure_details,
      triage: parseJson<SavedTriage | null>(r.triage, null),
      attachments,
    };
  }

  getItem(itemId: number): RunItem {
    const row = this.ctx.db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(itemId) as ItemRow | undefined;
    if (!row) throw notFound("Run item");
    const attachments = (
      this.ctx.db.prepare("SELECT * FROM attachments WHERE run_item_id = ? ORDER BY id").all(itemId) as AttachmentRow[]
    ).map(toAttachment);
    return this.toItem(row, attachments);
  }

  create(
    projectId: number,
    input: { name: string; environment: string; build: string; source?: Run["source"] },
    caseIds: number[],
  ): Run {
    return this.ctx.db.transaction(() => {
      const info = this.ctx.db
        .prepare(
          "INSERT INTO runs (project_id, name, environment, build, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(projectId, input.name, input.environment, input.build, input.source ?? "manual", this.ctx.clock.now());
      const runId = Number(info.lastInsertRowid);
      const insert = this.ctx.db.prepare("INSERT OR IGNORE INTO run_items (run_id, case_id) VALUES (?, ?)");
      for (const caseId of caseIds) insert.run(runId, caseId);
      return this.get(runId);
    })();
  }

  update(id: number, patch: RunPatch): Run {
    const run = this.get(id);
    this.ctx.db
      .prepare("UPDATE runs SET name = ?, environment = ?, build = ?, notes = ? WHERE id = ?")
      .run(
        patch.name ?? run.name,
        patch.environment ?? run.environment,
        patch.build ?? run.build,
        patch.notes ?? run.notes,
        id,
      );
    return this.get(id);
  }

  setStatus(id: number, status: Run["status"]): Run {
    const run = this.get(id);
    if (run.status === status) throw conflict(`Run is already ${status}`);
    this.ctx.db
      .prepare("UPDATE runs SET status = ?, closed_at = ? WHERE id = ?")
      .run(status, status === "closed" ? this.ctx.clock.now() : null, id);
    return this.get(id);
  }

  /** Returns the storage keys of evidence files that belonged to the run, so the caller can remove them. */
  delete(id: number): string[] {
    this.get(id);
    const keys = (
      this.ctx.db
        .prepare(
          `SELECT a.storage_key FROM attachments a JOIN run_items i ON i.id = a.run_item_id
           WHERE i.run_id = ? AND a.storage_key IS NOT NULL`,
        )
        .all(id) as { storage_key: string }[]
    ).map((r) => r.storage_key);
    this.ctx.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
    return keys;
  }

  assertOpen(runId: number): Run {
    const run = this.get(runId);
    if (run.status === "closed") throw conflict("This run is closed. Reopen it to change results.");
    return run;
  }

  patchItem(itemId: number, patch: RunItemPatch): RunItem {
    const item = this.getItem(itemId);
    this.assertOpen(item.runId);
    const status = patch.status ?? item.status;
    const statusChanged = patch.status !== undefined && patch.status !== item.status;
    let executedAt = item.executedAt;
    if (statusChanged) executedAt = status === "untested" ? null : this.ctx.clock.now();
    this.ctx.db
      .prepare(
        `UPDATE run_items SET status = ?, comment = ?, duration_ms = ?, executed_by = ?, executed_at = ?, triage = ?
         WHERE id = ?`,
      )
      .run(
        status,
        patch.comment ?? item.comment,
        patch.durationMs !== undefined ? patch.durationMs : item.durationMs,
        patch.executedBy ?? item.executedBy,
        executedAt,
        patch.triage !== undefined
          ? patch.triage === null
            ? null
            : JSON.stringify({ ...patch.triage, acceptedAt: this.ctx.clock.now() })
          : item.triage === null
            ? null
            : JSON.stringify(item.triage),
        itemId,
      );
    return this.getItem(itemId);
  }

  /** Used by the importer: adds the case to the run if needed and records an automated result. */
  upsertResult(runId: number, caseId: number, result: ItemResultUpdate): number {
    this.ctx.db.prepare("INSERT OR IGNORE INTO run_items (run_id, case_id) VALUES (?, ?)").run(runId, caseId);
    const row = this.ctx.db.prepare("SELECT id FROM run_items WHERE run_id = ? AND case_id = ?").get(runId, caseId) as {
      id: number;
    };
    this.ctx.db
      .prepare(
        `UPDATE run_items SET status = ?, duration_ms = ?, executed_by = ?, executed_at = ?, comment = ?,
           failure_message = ?, failure_details = ?
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.durationMs ?? null,
        result.executedBy ?? "",
        result.status === "untested" ? null : this.ctx.clock.now(),
        result.comment ?? "",
        result.failureMessage ?? "",
        result.failureDetails ?? "",
        row.id,
      );
    return row.id;
  }

  /** Every recorded result of a project's runs, oldest run first (input for the dashboard). */
  resultsForProject(projectId: number): { runId: number; caseId: number; status: ResultStatus }[] {
    return this.ctx.db
      .prepare(
        `SELECT i.run_id AS runId, i.case_id AS caseId, i.status FROM run_items i JOIN runs r ON r.id = i.run_id
         WHERE r.project_id = ? ORDER BY r.created_at, r.id`,
      )
      .all(projectId) as { runId: number; caseId: number; status: ResultStatus }[];
  }
}
