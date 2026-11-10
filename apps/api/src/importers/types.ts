export type ImportedStatus = "passed" | "failed" | "skipped";

export interface ImportedAttachment {
  name: string;
  contentType: string;
  /** Path on the machine that produced the report. Stored as metadata only: the file itself is not uploaded. */
  path: string;
}

/** One test result, independent of the report format. */
export interface ImportedResult {
  /** Automation reference: `classname#name` (JUnit) or `file#Describe > title` (Playwright). */
  ref: string;
  title: string;
  /** Test class or spec file, used to describe new cases. */
  group: string;
  status: ImportedStatus;
  durationMs: number | null;
  failureMessage: string;
  failureDetails: string;
  /** Free-text note, for example "passed on retry". */
  note: string;
  tags: string[];
  attachments: ImportedAttachment[];
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

const RANK: Record<ImportedStatus, number> = { skipped: 0, passed: 1, failed: 2 };

/** Worst status wins when the same test appears more than once (retries, browsers, devices). */
export function worstStatus(a: ImportedStatus, b: ImportedStatus): ImportedStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text;
