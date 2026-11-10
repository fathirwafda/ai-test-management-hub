import type { Platform, Priority, ResultStatus, RunCounts } from "@hub/shared";

export interface GenerateCasesInput {
  story: string;
  platformHint?: Platform | undefined;
  maxCases: number;
}

export interface TriageInput {
  caseKey: string;
  caseTitle: string;
  platform: Platform;
  automationRef: string | null;
  status: ResultStatus;
  failureMessage: string;
  /** Stack trace, logs, system-out, plus the tester's comment. Already truncated. */
  details: string;
  comment: string;
  /** Results of this case in earlier runs, oldest first. */
  previousStatuses: ResultStatus[];
}

export interface RunSummaryInput {
  name: string;
  environment: string;
  build: string;
  counts: RunCounts;
  passRate: number | null;
  items: {
    key: string;
    title: string;
    platform: Platform;
    priority: Priority;
    status: ResultStatus;
    failureMessage: string;
    triageCategory: string | null;
  }[];
}

/** The structured inputs behind each prompt. Real providers ignore them; the mock provider reads them. */
export type AiTask =
  | { kind: "generate-cases"; input: GenerateCasesInput }
  | { kind: "triage"; input: TriageInput }
  | { kind: "run-summary"; input: RunSummaryInput };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Overrides the provider's default model for this call. */
  model?: string | undefined;
  task: AiTask;
  /** 0 for the first attempt, 1 for the repair attempt. */
  attempt: number;
}

export interface CompletionResult {
  text: string;
  model: string;
}

export interface LlmProvider {
  readonly name: "mock" | "anthropic";
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "unavailable" | "bad_request" | "refusal",
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "AiProviderError";
  }
}

/** The model answered, but twice with output that does not match the schema. Nothing is saved. */
export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}
