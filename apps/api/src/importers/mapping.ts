import { normalizeRef } from "../repos/context.js";
import { worstStatus, type ImportedResult } from "./types.js";

export interface MappingIndex {
  /** normalized automation reference -> case id */
  byRef: Map<string, number>;
  /** TC number -> case id */
  byNumber: Map<number, number>;
}

export interface Mapped {
  result: ImportedResult;
  caseId: number | null;
  via: "key" | "ref" | null;
}

const KEY_PATTERN = /\bTC-(\d+)\b/gi;

/** Case keys mentioned in a test title, e.g. "checkout pays with card [TC-12]" -> [12]. */
export function caseNumbersIn(text: string): number[] {
  return [...text.matchAll(KEY_PATTERN)].map((m) => Number(m[1]));
}

/**
 * Finds the case for a result. A case key in the test title wins (explicit link, like Xray/TestRail ids),
 * then an exact match on the normalized automation reference.
 */
export function mapResult(result: ImportedResult, index: MappingIndex): Mapped {
  for (const n of caseNumbersIn(`${result.title} ${result.ref}`)) {
    const id = index.byNumber.get(n);
    if (id !== undefined) return { result, caseId: id, via: "key" };
  }
  const norm = normalizeRef(result.ref);
  const id = norm ? index.byRef.get(norm) : undefined;
  return id !== undefined ? { result, caseId: id, via: "ref" } : { result, caseId: null, via: null };
}

/** Merges results with the same reference (re-runs, parametrised duplicates). The worst status wins. */
export function mergeDuplicates(results: ImportedResult[]): ImportedResult[] {
  const byRef = new Map<string, ImportedResult>();
  for (const r of results) {
    const key = normalizeRef(r.ref) ?? r.ref;
    const existing = byRef.get(key);
    if (!existing) {
      byRef.set(key, { ...r, tags: [...r.tags], attachments: [...r.attachments] });
      continue;
    }
    existing.status = worstStatus(existing.status, r.status);
    existing.durationMs =
      existing.durationMs === null && r.durationMs === null ? null : (existing.durationMs ?? 0) + (r.durationMs ?? 0);
    existing.failureMessage ||= r.failureMessage;
    existing.failureDetails = [existing.failureDetails, r.failureDetails].filter(Boolean).join("\n\n");
    existing.note = [existing.note, r.note].filter(Boolean).join("; ");
    existing.tags = [...new Set([...existing.tags, ...r.tags])];
    existing.attachments.push(...r.attachments);
  }
  return [...byRef.values()];
}
