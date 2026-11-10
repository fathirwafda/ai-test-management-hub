import {
  GeneratedCases,
  RunSummarySuggestion,
  TriageSuggestion,
  type AiMeta,
  type GeneratedCase,
  type RunSummarySuggestion as RunSummaryType,
  type TriageSuggestion as TriageType,
} from "@hub/shared";
import type { z } from "zod";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { generateCasesPrompt, repairMessage, runSummaryPrompt, triagePrompt } from "./prompts.js";
import {
  AiOutputError,
  type AiTask,
  type ChatMessage,
  type GenerateCasesInput,
  type LlmProvider,
  type RunSummaryInput,
  type TriageInput,
} from "./types.js";

export function createProvider(config: {
  llmProvider: "mock" | "anthropic";
  llmModel: string;
  anthropicApiKey?: string | undefined;
}): LlmProvider {
  return config.llmProvider === "anthropic"
    ? new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.llmModel })
    : new MockProvider();
}

/** Pulls the JSON object out of a reply, tolerating Markdown fences or a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new SyntaxError("no JSON object found in the reply");
  }
}

function validate<T extends z.ZodType>(
  schema: T,
  text: string,
): { ok: true; data: z.output<T> } | { ok: false; issues: string[] } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (err) {
    return { ok: false, issues: [`reply is not valid JSON (${(err as Error).message})`] };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

/**
 * Calls the provider and validates the answer against a zod schema. If the first answer does not validate, the
 * model gets one repair turn with the validation errors. A second failure raises AiOutputError. Nothing here
 * writes to the database: the caller returns the suggestion to a person who decides what to keep.
 */
export async function runStructured<T extends z.ZodType>(
  provider: LlmProvider,
  schema: T,
  prompt: { system: string; user: string },
  task: AiTask,
  options: { maxTokens: number; model?: string | undefined },
): Promise<{ data: z.output<T>; meta: AiMeta }> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt.user }];
  const first = await provider.complete({
    system: prompt.system,
    messages,
    maxTokens: options.maxTokens,
    model: options.model,
    task,
    attempt: 0,
  });
  const checked = validate(schema, first.text);
  if (checked.ok) return { data: checked.data, meta: { provider: provider.name, model: first.model, repaired: false } };

  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first.text || "(empty reply)" },
    { role: "user", content: repairMessage(checked.issues) },
  ];
  const second = await provider.complete({
    system: prompt.system,
    messages: repairMessages,
    maxTokens: options.maxTokens,
    model: options.model,
    task,
    attempt: 1,
  });
  const rechecked = validate(schema, second.text);
  if (rechecked.ok)
    return { data: rechecked.data, meta: { provider: provider.name, model: second.model, repaired: true } };
  throw new AiOutputError("The AI reply did not match the expected format after one repair attempt.", rechecked.issues);
}

export class AiService {
  constructor(readonly provider: LlmProvider) {}

  async generateCases(input: GenerateCasesInput, model?: string): Promise<{ cases: GeneratedCase[]; meta: AiMeta }> {
    const { data, meta } = await runStructured(
      this.provider,
      GeneratedCases,
      generateCasesPrompt(input),
      { kind: "generate-cases", input },
      { maxTokens: 8000, model },
    );
    return { cases: data.cases.slice(0, input.maxCases), meta };
  }

  async triage(input: TriageInput, model?: string): Promise<{ suggestion: TriageType; meta: AiMeta }> {
    const { data, meta } = await runStructured(
      this.provider,
      TriageSuggestion,
      triagePrompt(input),
      { kind: "triage", input },
      { maxTokens: 2000, model },
    );
    return { suggestion: data, meta };
  }

  async runSummary(input: RunSummaryInput, model?: string): Promise<{ summary: RunSummaryType; meta: AiMeta }> {
    const { data, meta } = await runStructured(
      this.provider,
      RunSummarySuggestion,
      runSummaryPrompt(input),
      { kind: "run-summary", input },
      { maxTokens: 2000, model },
    );
    return { summary: data, meta };
  }
}
