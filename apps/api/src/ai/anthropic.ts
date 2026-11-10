import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_CLAUDE_MODEL } from "@hub/shared";
import { AiProviderError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types.js";

/** Models that support the server-side refusal fallback ("default" routing). */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export interface AnthropicProviderOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  /** Injected in tests so no request leaves the machine. */
  client?: Pick<Anthropic, "beta">;
}

export function toAiProviderError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError("The Anthropic API rejected the API key.", "auth", { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiProviderError("The Anthropic API rate limit was reached. Try again shortly.", "rate_limit", {
      cause: err,
    });
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new AiProviderError(`The Anthropic API rejected the request: ${err.message}`, "bad_request", { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIError) {
    return new AiProviderError("The Anthropic API is unavailable right now.", "unavailable", { cause: err });
  }
  return new AiProviderError(`AI provider error: ${(err as Error)?.message ?? String(err)}`, "unavailable", {
    cause: err,
  });
}

/** Claude through the official SDK (Messages API). */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Pick<Anthropic, "beta">;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    if (options.client) {
      this.client = options.client;
      return;
    }
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
      throw new AiProviderError("ANTHROPIC_API_KEY is not set; use LLM_PROVIDER=mock to run offline.", "auth");
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model ?? this.model;
    const fallback = FALLBACK_MODELS.has(model);
    let response;
    try {
      response = await this.client.beta.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        // Structured, short answers: low effort keeps latency and cost down.
        output_config: { effort: "low" },
        // If a safety classifier declines, the API re-runs the request on a suitable fallback model.
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (err) {
      throw toAiProviderError(err);
    }
    if (response.stop_reason === "refusal") {
      throw new AiProviderError("The model declined this request.", "refusal");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, model: response.model };
  }
}
