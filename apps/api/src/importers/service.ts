import path from "node:path";
import { ImportOptions, TestCaseInput, type ImportSummary } from "@hub/shared";
import type { z } from "zod";
import { attachmentKind, resolveMimeType } from "../lib/evidence-store.js";
import { badRequest, parse } from "../lib/errors.js";
import { normalizeRef } from "../repos/context.js";
import type { Store } from "../repos/store.js";
import { parseJUnit, looksLikeJUnit } from "./junit.js";
import { mapResult, mergeDuplicates } from "./mapping.js";
import { looksLikePlaywright, parsePlaywrightJson } from "./playwright.js";
import { ImportFormatError, type ImportedResult } from "./types.js";

type Options = z.output<typeof ImportOptions>;

export function detectFormat(content: string, requested: Options["format"]): "junit" | "playwright" {
  if (requested !== "auto") return requested;
  const head = content.trimStart();
  if (head.startsWith("<")) {
    if (looksLikeJUnit(head)) return "junit";
    throw new ImportFormatError("XML file is not a JUnit report");
  }
  if (head.startsWith("{")) {
    try {
      if (looksLikePlaywright(JSON.parse(head))) return "playwright";
    } catch {
      throw new ImportFormatError("File is neither valid JSON nor XML");
    }
    throw new ImportFormatError("JSON file is not a Playwright JSON report (expected `config` and `suites`)");
  }
  throw new ImportFormatError("Unrecognised file. Upload JUnit XML or Playwright JSON reporter output.");
}

export function parseReport(content: string, format: "junit" | "playwright"): ImportedResult[] {
  return format === "junit" ? parseJUnit(content) : parsePlaywrightJson(content);
}

function defaultRunName(format: string, now: string): string {
  return `${format === "junit" ? "JUnit" : "Playwright"} import ${now.slice(0, 16).replace("T", " ")}`;
}

/**
 * Imports automated results into a run: maps each result to a case, creates flagged draft cases for the
 * ones that match nothing, and records status, duration, failure output and attachment metadata.
 * Runs in one transaction, so a bad report changes nothing.
 */
export function importResults(
  store: Store,
  projectId: number,
  content: string,
  rawOptions: ImportOptions,
): ImportSummary {
  const options = parse(ImportOptions, rawOptions);
  store.projects.get(projectId);
  if (options.suiteId) store.suites.assertInProject(options.suiteId, projectId);

  const format = detectFormat(content, options.format);
  const parsed = parseReport(content, format);
  if (parsed.length === 0) throw badRequest("The report contains no test cases");
  const results = mergeDuplicates(parsed);
  const warnings: string[] = [];
  if (results.length < parsed.length) {
    warnings.push(`${parsed.length - results.length} duplicate result(s) were merged (same automation reference).`);
  }

  return store.transaction(() => {
    const run = options.runId
      ? store.runs.assertOpen(options.runId)
      : store.runs.create(
          projectId,
          {
            name: options.runName || defaultRunName(format, store.ctx.clock.now()),
            environment: options.environment,
            build: options.build,
            source: "import",
          },
          [],
        );
    if (run.projectId !== projectId) throw badRequest("runId belongs to another project");

    const index = store.cases.mappingIndex(projectId);
    const summary: ImportSummary = {
      runId: run.id,
      format,
      total: results.length,
      mapped: 0,
      created: 0,
      createdCases: [],
      results: { passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0 },
      warnings,
    };

    for (const result of results) {
      const mapped = mapResult(result, index);
      let caseId = mapped.caseId;
      if (caseId === null) {
        const created = store.cases.create(
          projectId,
          TestCaseInput.parse({
            suiteId: options.suiteId ?? null,
            title: result.title.slice(0, 300),
            description: `Created automatically from a ${format === "junit" ? "JUnit" : "Playwright"} import (${result.group}). Review the title, steps and platform, then set the status to ready.`,
            platform: options.platform,
            type: "automated",
            automationRef: result.ref.slice(0, 500),
            tags: result.tags.slice(0, 20),
            status: "draft",
            source: "import",
          }),
          { needsReview: true },
        );
        caseId = created.id;
        const norm = normalizeRef(created.automationRef);
        if (norm) index.byRef.set(norm, caseId);
        summary.created += 1;
        summary.createdCases.push({ id: created.id, key: created.key, title: created.title });
      } else {
        summary.mapped += 1;
      }

      const itemId = store.runs.upsertResult(run.id, caseId, {
        status: result.status,
        durationMs: result.durationMs,
        executedBy: options.executedBy,
        comment: result.note,
        failureMessage: result.failureMessage,
        failureDetails: result.failureDetails,
      });
      summary.results[result.status] += 1;

      for (const a of result.attachments) {
        const fileName = path.basename(a.path.replace(/\\/g, "/")) || a.name;
        const mimeType = resolveMimeType(fileName, a.contentType);
        store.attachments.create({
          runItemId: itemId,
          fileName: `${a.name} (${fileName})`.slice(0, 200),
          mimeType,
          sizeBytes: 0,
          kind: attachmentKind(fileName, mimeType),
          storageKey: null,
          externalPath: a.path.slice(0, 1000),
        });
      }
    }
    if (summary.created > 0) {
      summary.warnings.push(
        `${summary.created} result(s) matched no case; draft cases flagged "needs review" were created.`,
      );
    }
    return summary;
  });
}
