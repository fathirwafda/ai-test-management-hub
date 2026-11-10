import type { Attachment } from "@hub/shared";
import { notFound } from "../lib/errors.js";
import type { RepoContext } from "./context.js";
import { toAttachment, type AttachmentRow } from "./runs.js";

export interface NewAttachment {
  runItemId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: Attachment["kind"];
  storageKey: string | null;
  externalPath: string | null;
}

export class AttachmentRepo {
  constructor(private readonly ctx: RepoContext) {}

  create(a: NewAttachment): Attachment {
    const info = this.ctx.db
      .prepare(
        `INSERT INTO attachments (run_item_id, file_name, mime_type, size_bytes, kind, storage_key, external_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.runItemId,
        a.fileName,
        a.mimeType,
        a.sizeBytes,
        a.kind,
        a.storageKey,
        a.externalPath,
        this.ctx.clock.now(),
      );
    return this.get(Number(info.lastInsertRowid));
  }

  row(id: number): AttachmentRow {
    const row = this.ctx.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRow | undefined;
    if (!row) throw notFound("Attachment");
    return row;
  }

  get(id: number): Attachment {
    return toAttachment(this.row(id));
  }

  /** Returns the storage key (if a file was stored) so the caller can delete the file. */
  delete(id: number): string | null {
    const row = this.row(id);
    this.ctx.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    return row.storage_key;
  }
}
