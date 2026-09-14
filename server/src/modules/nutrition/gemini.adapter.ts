import { ApiError, GoogleGenAI } from "@google/genai";

import type { ProviderState } from "../../config/env.js";
import { ProviderFailure, cancellationFailure } from "./nutrition.failures.js";
import {
  MAX_PROVIDER_TEXT_BYTES,
  hasKnownNetworkCause,
  nutritionPrompt,
  parseProviderText,
  type ProviderAdapter,
} from "./provider-common.js";
import { PROVIDER_OUTPUT_JSON_SCHEMA } from "./nutrition.schemas.js";

interface GeminiInteraction {
  output_text?: string;
  status?: string;
  errors?: Array<{ code?: string }>;
}

interface GeminiClient {
  interactions: {
    create(
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ): Promise<GeminiInteraction>;
  };
}

export function createGeminiAdapter(
  state: ProviderState,
  createClient: (apiKey: string) => GeminiClient = (apiKey) =>
    new GoogleGenAI({ apiKey }) as GeminiClient,
): ProviderAdapter {
  return {
    name: "gemini",
    async analyze({ image, imageType, signal, timeoutMs }) {
      if (state.status !== "configured") {
        throw new ProviderFailure("configuration", "Gemini is not configured.");
      }
      const attempt = new AbortController();
      const deadline = setTimeout(() => attempt.abort("provider-timeout"), timeoutMs);
      deadline.unref();
      const relayAbort = (): void => attempt.abort(signal.reason);
      signal.addEventListener("abort", relayAbort, { once: true });

      try {
        const client = createClient(state.apiKey);
        const result = await client.interactions.create(
          {
            model: state.model,
            input: [
              { type: "text", text: nutritionPrompt(imageType) },
              {
                type: "image",
                data: image.toString("base64"),
                mime_type: "image/jpeg",
              },
            ],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: PROVIDER_OUTPUT_JSON_SCHEMA,
            },
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
          return machineCode.includes("SAFETY") ||
            machineCode.includes("CONTENT_POLICY");
        });
        if (refused) {
          throw new ProviderFailure("content", "Gemini refused the image.", {
            contentStatus: "refused",
          });
        }
        if (result.status && result.status !== "completed") {
          throw new ProviderFailure("output_invalid", "Gemini response was incomplete.");
        }
        if (
          typeof result.output_text === "string" &&
          Buffer.byteLength(result.output_text, "utf8") > MAX_PROVIDER_TEXT_BYTES
        ) {
          throw new ProviderFailure("output_invalid", "Gemini output was oversized.");
        }
        return parseProviderText(result.output_text);
      } catch (error) {
        if (error instanceof ProviderFailure) {
          throw error;
        }
        if (signal.aborted) {
          throw cancellationFailure(error);
        }
        if (attempt.signal.aborted) {
          throw new ProviderFailure("unavailable", "Gemini timed out.", { cause: error });
        }
        if (error instanceof ApiError) {
          if ([401, 403, 404].includes(error.status)) {
            throw new ProviderFailure("configuration", "Gemini rejected its configuration.", { cause: error });
          }
          if (error.status === 429 || error.status >= 500) {
            throw new ProviderFailure("unavailable", "Gemini is unavailable.", { cause: error });
          }
          // A provider 400 means our constructed request/schema is invalid, not
          // an outage that another provider should conceal.
          throw new ProviderFailure("application_bug", "Gemini request was rejected.", { cause: error });
        }
        if (hasKnownNetworkCause(error)) {
          throw new ProviderFailure("unavailable", "Gemini connection failed.", { cause: error });
        }
        throw new ProviderFailure("application_bug", "Unexpected Gemini adapter failure.", { cause: error });
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener("abort", relayAbort);
      }
    },
  };
}
