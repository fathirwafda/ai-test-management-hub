import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment } from "@hub/shared";

const TEXT_EXTENSIONS = new Set([".txt", ".log", ".json", ".har", ".xml", ".csv", ".md", ".yaml", ".yml"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
const BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".json": "application/json",
  ".har": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
};

/** Decides the MIME type from the client's value, falling back to the extension for generic values. */
export function resolveMimeType(fileName: string, clientType: string | undefined): string {
  const type = (clientType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  return BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/**
 * How the UI may preview a file. SVG and HTML are deliberately "file": they can carry script, so they are only
 * offered as downloads.
 */
export function attachmentKind(fileName: string, mimeType: string): Attachment["kind"] {
  if (IMAGE_TYPES.has(mimeType)) return "image";
  if (VIDEO_TYPES.has(mimeType)) return "video";
  const ext = path.extname(fileName).toLowerCase();
  if (mimeType === "text/html" || ext === ".html" || ext === ".htm" || ext === ".svg") return "file";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") return "text";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "file";
}

/** Strips directories and control characters from a client-supplied file name. */
export function safeFileName(name: string): string {
  const base = path
    .basename(name.replace(/\\/g, "/"))
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (base || "file").slice(0, 200);
}

/** Evidence files on local disk. Files are stored under random names; the original name lives in the database. */
export class EvidenceStore {
  constructor(readonly root: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async save(data: Buffer, fileName: string): Promise<string> {
    const ext = path
      .extname(safeFileName(fileName))
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 10);
    const key = `${randomUUID()}${ext}`;
    await fs.writeFile(this.resolve(key), data);
    return key;
  }

  /** Absolute path for a storage key. Keys come from the database, but the check keeps a bad row from escaping. */
  resolve(key: string): string {
    if (!/^[0-9a-f-]{36}(\.[a-z0-9]{1,9})?$/.test(key)) throw new Error(`invalid storage key: ${key}`);
    return path.join(this.root, key);
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}
