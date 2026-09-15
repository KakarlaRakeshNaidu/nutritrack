import { ApiError, GoogleGenAI } from "@google/genai";

import type { ProviderState } from "../../config/env.js";
import { ProviderFailure, cancellationFailure } from "./nutrition.failures.js";
import {
  MAX_PROVIDER_TEXT_BYTES,
  hasKnownNetworkCause,
} from "./provider-common.js";

export interface GeminiInteraction {
  output_text?: string;
  status?: string;
  errors?: Array<{ code?: string }>;
}

export interface GeminiClient {
  interactions: {
    create(
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ): Promise<GeminiInteraction>;
  };
}

export type GeminiClientFactory = (apiKey: string) => GeminiClient;

export async function requestGeminiJson({
  state,
  createClient = (apiKey) => new GoogleGenAI({ apiKey }) as GeminiClient,
  input,
  responseSchema,
  tools,
  signal,
  timeoutMs,
}: {
  state: ProviderState;
  createClient?: GeminiClientFactory;
  input: unknown[];
  responseSchema: Record<string, unknown>;
  tools?: [];
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  if (state.status !== "configured") {
    throw new ProviderFailure("configuration", "Gemini is not configured.");
  }

  const attempt = new AbortController();
  const deadline = setTimeout(
    () => attempt.abort("provider-timeout"),
    timeoutMs,
  );
  deadline.unref();
  const relayAbort = (): void => attempt.abort(signal.reason);
  signal.addEventListener("abort", relayAbort, { once: true });

  try {
    const result = await createClient(state.apiKey).interactions.create(
      {
        model: state.model,
        input,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: responseSchema,
        },
        ...(tools ? { tools } : {}),
        store: false,
        background: false,
        stream: false,
      },
      {
        signal: attempt.signal,
        timeout_ms: timeoutMs,
        retries: { strategy: "none" },
        maxRetries: 0,
      },
    );

    const refused = result.errors?.some(({ code }) => {
      const machineCode = code?.toUpperCase() ?? "";
      return (
        machineCode.includes("SAFETY") ||
        machineCode.includes("CONTENT_POLICY")
      );
    });
    if (refused) {
      throw new ProviderFailure("content", "Gemini refused the request.", {
        contentStatus: "refused",
      });
    }
    if (result.status && result.status !== "completed") {
      throw new ProviderFailure(
        "output_invalid",
        "Gemini response was incomplete.",
      );
    }
    if (
      typeof result.output_text !== "string" ||
      Buffer.byteLength(result.output_text, "utf8") > MAX_PROVIDER_TEXT_BYTES
    ) {
      throw new ProviderFailure(
        "output_invalid",
        "Gemini output was absent or oversized.",
      );
    }
    return result.output_text;
  } catch (error) {
    if (error instanceof ProviderFailure) {
      throw error;
    }
    if (signal.aborted) {
      throw cancellationFailure(error);
    }
    if (attempt.signal.aborted) {
      throw new ProviderFailure("unavailable", "Gemini timed out.", {
        cause: error,
      });
    }
    if (error instanceof ApiError) {
      if ([401, 403, 404].includes(error.status)) {
        throw new ProviderFailure(
          "configuration",
          "Gemini rejected its configuration.",
          { cause: error },
        );
      }
      if (error.status === 429 || error.status >= 500) {
        throw new ProviderFailure("unavailable", "Gemini is unavailable.", {
          cause: error,
        });
      }
      throw new ProviderFailure(
        "application_bug",
        "Gemini request was rejected.",
        { cause: error },
      );
    }
    if (hasKnownNetworkCause(error)) {
      throw new ProviderFailure(
        "unavailable",
        "Gemini connection failed.",
        { cause: error },
      );
    }
    throw new ProviderFailure(
      "application_bug",
      "Unexpected Gemini adapter failure.",
      { cause: error },
    );
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", relayAbort);
  }
}
