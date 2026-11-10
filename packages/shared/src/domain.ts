import { z } from "zod";

export const PLATFORMS = ["API", "Web", "Mobile-Android", "Mobile-iOS"] as const;
export const CASE_TYPES = ["manual", "automated"] as const;
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const CASE_STATUSES = ["draft", "ready", "deprecated"] as const;
export const CASE_SOURCES = ["manual", "import", "ai"] as const;
export const RESULT_STATUSES = ["untested", "passed", "failed", "blocked", "skipped", "retest"] as const;
export const RUN_STATUSES = ["open", "closed"] as const;
export const TRIAGE_CATEGORIES = ["product_bug", "test_issue", "environment", "data"] as const;

export const Platform = z.enum(PLATFORMS);
export const CaseType = z.enum(CASE_TYPES);
export const Priority = z.enum(PRIORITIES);
export const CaseStatus = z.enum(CASE_STATUSES);
export const CaseSource = z.enum(CASE_SOURCES);
export const ResultStatus = z.enum(RESULT_STATUSES);
export const RunStatus = z.enum(RUN_STATUSES);
export const TriageCategory = z.enum(TRIAGE_CATEGORIES);

export type Platform = z.infer<typeof Platform>;
export type CaseType = z.infer<typeof CaseType>;
export type Priority = z.infer<typeof Priority>;
export type CaseStatus = z.infer<typeof CaseStatus>;
export type CaseSource = z.infer<typeof CaseSource>;
export type ResultStatus = z.infer<typeof ResultStatus>;
export type RunStatus = z.infer<typeof RunStatus>;
export type TriageCategory = z.infer<typeof TriageCategory>;

const trimmed = (max: number) => z.string().trim().max(max);
const id = z.number().int().positive();

// ---------- Projects and suites ----------

export const ProjectInput = z.object({
  name: trimmed(120).min(1),
  description: trimmed(2000).default(""),
});
export type ProjectInput = z.input<typeof ProjectInput>;

export interface Project {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  caseCount: number;
  runCount: number;
}

export const SuiteInput = z.object({
  name: trimmed(120).min(1),
  description: trimmed(2000).default(""),
});
export type SuiteInput = z.input<typeof SuiteInput>;

export interface Suite {
  id: number;
  projectId: number;
  name: string;
  description: string;
  caseCount: number;
}

// ---------- Test cases ----------

export const TestStep = z.object({
  action: trimmed(2000).min(1),
  expected: trimmed(2000).default(""),
});
export type TestStep = z.infer<typeof TestStep>;

export const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "tags use letters, digits, '.', '_' or '-'");

export const TestCaseInput = z
  .object({
    suiteId: id.nullable().default(null),
    title: trimmed(300).min(1),
    description: trimmed(5000).default(""),
    preconditions: trimmed(5000).default(""),
    steps: z.array(TestStep).max(50).default([]),
    priority: Priority.default("medium"),
    tags: z.array(Tag).max(20).default([]),
    platform: Platform,
    type: CaseType.default("manual"),
    automationRef: trimmed(500).nullable().default(null),
    requirement: trimmed(5000).default(""),
    status: CaseStatus.default("draft"),
    source: CaseSource.default("manual"),
  })
  .transform((c) => ({
    ...c,
    tags: [...new Set(c.tags)],
    automationRef: c.automationRef ? c.automationRef : null,
  }));
export type TestCaseInput = z.input<typeof TestCaseInput>;
export type TestCaseData = z.output<typeof TestCaseInput>;

/** PATCH body: every field optional, plus `needsReview` so a reviewer can clear the import flag. */
export const TestCasePatch = z.object({
  suiteId: id.nullable().optional(),
  title: trimmed(300).min(1).optional(),
  description: trimmed(5000).optional(),
  preconditions: trimmed(5000).optional(),
  steps: z.array(TestStep).max(50).optional(),
  priority: Priority.optional(),
  tags: z.array(Tag).max(20).optional(),
  platform: Platform.optional(),
  type: CaseType.optional(),
  automationRef: trimmed(500).nullable().optional(),
  requirement: trimmed(5000).optional(),
  status: CaseStatus.optional(),
  needsReview: z.boolean().optional(),
});
export type TestCasePatch = z.infer<typeof TestCasePatch>;

export interface TestCase {
  id: number;
  projectId: number;
  suiteId: number | null;
  key: string;
  title: string;
  description: string;
  preconditions: string;
  steps: TestStep[];
  priority: Priority;
  tags: string[];
  platform: Platform;
  type: CaseType;
  automationRef: string | null;
  requirement: string;
  status: CaseStatus;
  source: CaseSource;
  /** Set on cases created automatically (results import). A person should review them. */
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(item),
  );

/** Filter used by the case list and by "create run from filter". */
export const CaseFilter = z.object({
  suiteId: z.coerce.number().int().positive().optional(),
  platforms: csv(Platform).optional(),
  types: csv(CaseType).optional(),
  statuses: csv(CaseStatus).optional(),
  priorities: csv(Priority).optional(),
  tags: csv(Tag).optional(),
  q: z.string().trim().max(200).optional(),
  needsReview: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional(),
});
export type CaseFilter = z.infer<typeof CaseFilter>;

// ---------- Runs ----------

export const RunInput = z
  .object({
    name: trimmed(200).min(1),
    environment: trimmed(120).default(""),
    build: trimmed(120).default(""),
    /** Explicit case selection. When omitted, `filter` decides (deprecated cases are always excluded). */
    caseIds: z.array(id).max(5000).optional(),
    filter: CaseFilter.omit({ q: true }).default({}),
  })
  .refine((r) => !(r.caseIds && r.caseIds.length === 0), { message: "caseIds must not be empty" });
export type RunInput = z.input<typeof RunInput>;

export interface RunCounts {
  total: number;
  untested: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  retest: number;
}

export interface Run {
  id: number;
  projectId: number;
  name: string;
  environment: string;
  build: string;
  status: RunStatus;
  source: "manual" | "import";
  notes: string;
  createdAt: string;
  closedAt: string | null;
  counts: RunCounts;
  /** passed / (passed + failed + blocked + retest); null when nothing was executed. */
  passRate: number | null;
  /** Share of items that are no longer "untested". */
  progress: number;
}

export const RunPatch = z.object({
  name: trimmed(200).min(1).optional(),
  environment: trimmed(120).optional(),
  build: trimmed(120).optional(),
  notes: trimmed(10000).optional(),
});
export type RunPatch = z.infer<typeof RunPatch>;

export const SavedTriage = z.object({
  category: TriageCategory,
  summary: trimmed(2000),
  acceptedBy: trimmed(120).default(""),
  acceptedAt: z.string().optional(),
});
export type SavedTriage = z.infer<typeof SavedTriage>;

export const RunItemPatch = z.object({
  status: ResultStatus.optional(),
  comment: trimmed(10000).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  executedBy: trimmed(120).optional(),
  triage: SavedTriage.nullable().optional(),
});
export type RunItemPatch = z.infer<typeof RunItemPatch>;

export interface Attachment {
  id: number;
  runItemId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "text" | "file";
  /** False for metadata-only evidence (for example a Playwright attachment path from an imported report). */
  stored: boolean;
  externalPath: string | null;
  createdAt: string;
}

export interface RunItem {
  id: number;
  runId: number;
  caseId: number;
  caseKey: string;
  caseTitle: string;
  platform: Platform;
  type: CaseType;
  priority: Priority;
  automationRef: string | null;
  status: ResultStatus;
  comment: string;
  durationMs: number | null;
  executedBy: string;
  executedAt: string | null;
  failureMessage: string;
  failureDetails: string;
  triage: SavedTriage | null;
  attachments: Attachment[];
}

export interface RunDetail extends Run {
  items: RunItem[];
}

export interface CaseHistoryEntry {
  runId: number;
  runName: string;
  status: ResultStatus;
  executedAt: string | null;
  createdAt: string;
}

// ---------- Results import ----------

export const IMPORT_FORMATS = ["auto", "junit", "playwright"] as const;
export const ImportOptions = z.object({
  format: z.enum(IMPORT_FORMATS).default("auto"),
  runId: z.coerce.number().int().positive().optional(),
  runName: trimmed(200).optional(),
  environment: trimmed(120).default(""),
  build: trimmed(120).default(""),
  /** Platform given to cases that are created because nothing matched. */
  platform: Platform.default("API"),
  suiteId: z.coerce.number().int().positive().optional(),
  executedBy: trimmed(120).default("ci"),
});
export type ImportOptions = z.input<typeof ImportOptions>;

export interface ImportSummary {
  runId: number;
  format: "junit" | "playwright";
  total: number;
  mapped: number;
  created: number;
  createdCases: { id: number; key: string; title: string }[];
  results: Record<Exclude<ResultStatus, "untested">, number>;
  warnings: string[];
}
