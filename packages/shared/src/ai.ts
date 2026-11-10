import { z } from "zod";
import { CaseType, Platform, Priority, TriageCategory } from "./domain.js";

export const CLAUDE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
export const ClaudeModel = z.enum(CLAUDE_MODELS);

export interface AiStatus {
  provider: "mock" | "anthropic";
  model: string;
  models: string[];
}

/** Metadata returned with every AI suggestion so the UI can label where it came from. */
export interface AiMeta {
  provider: "mock" | "anthropic";
  model: string;
  /** True when the first answer failed validation and a repair call fixed it. */
  repaired: boolean;
}

// ---------- 1. Test case generation ----------

export const GenerateCasesRequest = z.object({
  story: z.string().trim().min(20, "paste a user story or acceptance criteria (20+ characters)").max(20000),
  platformHint: Platform.optional(),
  maxCases: z.number().int().min(1).max(15).default(8),
  model: ClaudeModel.optional(),
});
export type GenerateCasesRequest = z.input<typeof GenerateCasesRequest>;

export const GeneratedStep = z.object({
  keyword: z.enum(["Given", "When", "Then", "And"]),
  text: z.string().trim().min(1).max(500),
});

export const GeneratedCase = z.object({
  title: z.string().trim().min(5).max(200),
  platform: Platform,
  priority: Priority,
  suggestedType: CaseType,
  rationale: z.string().trim().max(500),
  steps: z.array(GeneratedStep).min(2).max(12),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(6),
});
export type GeneratedCase = z.infer<typeof GeneratedCase>;

export const GeneratedCases = z.object({
  cases: z.array(GeneratedCase).min(1).max(15),
});

export interface GenerateCasesResponse {
  meta: AiMeta;
  cases: GeneratedCase[];
}

// ---------- 2. Failure triage ----------

export const TriageSuggestion = z.object({
  category: TriageCategory,
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().trim().min(1).max(400),
  reasoning: z.string().trim().min(1).max(1500),
  signals: z.array(z.string().trim().min(1).max(200)).max(8),
  nextSteps: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
});
export type TriageSuggestion = z.infer<typeof TriageSuggestion>;

export interface TriageResponse {
  meta: AiMeta;
  suggestion: TriageSuggestion;
}

// ---------- 3. Run summary ----------

export const RunSummarySuggestion = z.object({
  verdict: z.enum(["ready", "ready_with_risks", "not_ready"]),
  headline: z.string().trim().min(1).max(200),
  highlights: z.array(z.string().trim().min(1).max(300)).max(6),
  risks: z.array(z.string().trim().min(1).max(300)).max(8),
  recommendation: z.string().trim().min(1).max(600),
});
export type RunSummarySuggestion = z.infer<typeof RunSummarySuggestion>;

export interface RunSummaryResponse {
  meta: AiMeta;
  summary: RunSummarySuggestion;
}

export const AiModelChoice = z.object({ model: ClaudeModel.optional() });

export const TRIAGE_LABELS: Record<z.infer<typeof TriageCategory>, string> = {
  product_bug: "Product bug",
  test_issue: "Test issue",
  environment: "Environment",
  data: "Test data",
};
