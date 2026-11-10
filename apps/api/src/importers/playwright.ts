import { z } from "zod";
import {
  ImportFormatError,
  stripAnsi,
  truncate,
  worstStatus,
  type ImportedAttachment,
  type ImportedResult,
  type ImportedStatus,
} from "./types.js";

/**
 * Parses the Playwright JSON reporter output (`--reporter=json`). Only the fields we use are validated, so
 * reports from newer Playwright versions still load.
 *
 * One result is produced per spec. When a spec ran in several projects (browsers, devices), the worst
 * outcome wins and the per-project outcomes go into the note. A "flaky" test (failed, then passed on retry)
 * is recorded as passed with a note, so the dashboard and the reviewer can still see it.
 */

const PwError = z.object({ message: z.string().optional(), stack: z.string().optional() }).loose();
const PwAttachment = z.object({ name: z.string(), contentType: z.string(), path: z.string().optional() }).loose();
const PwResult = z
  .object({
    status: z.string().optional(),
    duration: z.number().optional(),
    retry: z.number().optional(),
    error: PwError.optional(),
    errors: z.array(PwError).optional(),
    attachments: z.array(PwAttachment).optional(),
  })
  .loose();
const PwTest = z
  .object({
    projectName: z.string().optional(),
    status: z.enum(["expected", "unexpected", "flaky", "skipped"]),
    results: z.array(PwResult).default([]),
  })
  .loose();
const PwSpec = z
  .object({
    title: z.string(),
    file: z.string().optional(),
    tags: z.array(z.string()).optional(),
    tests: z.array(PwTest).default([]),
  })
  .loose();

interface PwSuite {
  title: string;
  file?: string | undefined;
  specs?: z.infer<typeof PwSpec>[] | undefined;
  suites?: PwSuite[] | undefined;
}
const PwSuiteSchema: z.ZodType<PwSuite> = z.lazy(() =>
  z
    .object({
      title: z.string(),
      file: z.string().optional(),
      specs: z.array(PwSpec).optional(),
      suites: z.array(PwSuiteSchema).optional(),
    })
    .loose(),
);
const PwReport = z.object({ config: z.unknown().optional(), suites: z.array(PwSuiteSchema) }).loose();

export function looksLikePlaywright(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { suites?: unknown }).suites) &&
    "config" in value
  );
}

const STATUS: Record<z.infer<typeof PwTest>["status"], ImportedStatus> = {
  expected: "passed",
  flaky: "passed",
  unexpected: "failed",
  skipped: "skipped",
};

function walk(suite: PwSuite, titles: string[], file: string, out: ImportedResult[]): void {
  const fileName = suite.file ?? file;
  // The top-level suite of each file is titled with the file name; it is not part of the test's title path.
  const path = suite.title && suite.title !== fileName ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) out.push(toResult(spec, path, spec.file ?? fileName));
  for (const child of suite.suites ?? []) walk(child, path, fileName, out);
}

function toResult(spec: z.infer<typeof PwSpec>, titles: string[], file: string): ImportedResult {
  const fullTitle = [...titles, spec.title].join(" > ");
  let status: ImportedStatus = "skipped";
  let duration = 0;
  let failureMessage = "";
  const details: string[] = [];
  const notes: string[] = [];
  const attachments: ImportedAttachment[] = [];

  spec.tests.forEach((test, index) => {
    const s = STATUS[test.status];
    status = index === 0 ? s : worstStatus(status, s);
    const project = test.projectName || "default";
    const last = test.results.at(-1);
    duration += last?.duration ?? 0;
    if (test.status === "flaky") notes.push(`${project}: flaky, passed on retry ${last?.retry ?? 1}`);
    if (spec.tests.length > 1) notes.push(`${project}: ${s}`);
    if (test.status === "unexpected") {
      const failed = [...test.results].reverse().find((r) => r.status !== "passed") ?? last;
      const err = failed?.error ?? failed?.errors?.[0];
      const message = stripAnsi(err?.message ?? "").trim();
      if (!failureMessage) failureMessage = message.split("\n")[0] ?? "";
      details.push(`[${project}]\n${stripAnsi(err?.stack ?? err?.message ?? "").trim()}`);
      for (const a of failed?.attachments ?? []) {
        if (a.path) attachments.push({ name: `${project}: ${a.name}`, contentType: a.contentType, path: a.path });
      }
    }
  });

  return {
    ref: `${file}#${fullTitle}`,
    title: fullTitle,
    group: file,
    status,
    durationMs: spec.tests.length ? Math.round(duration) : null,
    failureMessage: truncate(failureMessage, 2000),
    failureDetails: truncate(details.join("\n\n"), 20_000),
    note: [...new Set(notes)].join("; "),
    tags: (spec.tags ?? [])
      .map((t) => t.replace(/^@/, "").toLowerCase())
      .filter((t) => /^[a-z0-9][a-z0-9._-]*$/.test(t)),
    attachments,
  };
}

export function parsePlaywrightJson(content: unknown): ImportedResult[] {
  let raw: unknown = content;
  if (typeof content === "string") {
    try {
      raw = JSON.parse(content);
    } catch (err) {
      throw new ImportFormatError(`Invalid JSON: ${(err as Error).message}`);
    }
  }
  const parsed = PwReport.safeParse(raw);
  if (!parsed.success) {
    throw new ImportFormatError(`Not a Playwright JSON report: ${parsed.error.issues[0]?.message ?? "unknown shape"}`);
  }
  const out: ImportedResult[] = [];
  for (const suite of parsed.data.suites) walk(suite, [], suite.file ?? suite.title, out);
  return out;
}
