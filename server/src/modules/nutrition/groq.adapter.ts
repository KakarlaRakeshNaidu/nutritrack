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

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const MAX_RESPONSE_BYTES = 131_072;

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) {
    throw new ProviderFailure("output_invalid", "Grok response body was absent.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    size += result.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderFailure("output_invalid", "Grok response was oversized.");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function outputText(envelope: unknown): string {
  if (!envelope || typeof envelope !== "object") {
    throw new ProviderFailure("output_invalid", "Grok response envelope was invalid.");
  }
  if (Reflect.get(envelope, "status") !== "completed") {
    const error = Reflect.get(envelope, "error");
    if (error && typeof error === "object" && Reflect.get(error, "code") === "content_policy_violation") {
      throw new ProviderFailure("content", "Grok refused the image.", {
        contentStatus: "refused",
      });
    }
    throw new ProviderFailure("output_invalid", "Grok response was incomplete.");
  }
  const output = Reflect.get(envelope, "output");
  if (!Array.isArray(output)) {
    throw new ProviderFailure("output_invalid", "Grok output was absent.");
  }
  for (const item of output) {
    if (!item || typeof item !== "object" || Reflect.get(item, "type") !== "message") {
      continue;
    }
    const content = Reflect.get(item, "content");
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part && typeof part === "object" && Reflect.get(part, "type") === "refusal") {
        throw new ProviderFailure("content", "Grok refused the image.", {
          contentStatus: "refused",
        });
      }
      if (part && typeof part === "object" && Reflect.get(part, "type") === "output_text") {
        const text = Reflect.get(part, "text");
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }
  throw new ProviderFailure("output_invalid", "Grok output text was absent.");
}

export function createGrokAdapter(
  state: ProviderState,
  fetchImplementation: typeof fetch = fetch,
): ProviderAdapter {
  return {
    name: "grok",
    async analyze({ image, imageType, signal, timeoutMs }) {
      if (state.status !== "configured") {
        throw new ProviderFailure("configuration", "Grok is not configured.");
      }
      const attempt = new AbortController();
      const deadline = setTimeout(() => attempt.abort("provider-timeout"), timeoutMs);
      deadline.unref();
      const relayAbort = (): void => attempt.abort(signal.reason);
      signal.addEventListener("abort", relayAbort, { once: true });

      try {
        const response = await fetchImplementation(XAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${state.apiKey}`,
            "content-type": "application/json",
          },
          signal: attempt.signal,
          body: JSON.stringify({
            model: state.model,
            input: [{
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: `data:image/jpeg;base64,${image.toString("base64")}`,
                  detail: "high",
                },
                { type: "input_text", text: nutritionPrompt(imageType) },
              ],
            }],
            text: {
              format: {
                type: "json_schema",
                name: "nutrition_extraction",
                schema: PROVIDER_OUTPUT_JSON_SCHEMA,
                strict: true,
              },
            },
            store: false,
            background: false,
            tools: [],
            max_output_tokens: 2_000,
          }),
        });

        if ([401, 403, 404].includes(response.status)) {
          await response.body?.cancel();
          throw new ProviderFailure("configuration", "Grok rejected its configuration.");
        }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          throw new ProviderFailure("unavailable", "Grok is unavailable.");
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderFailure("application_bug", "Grok request was rejected.");
        }

        const responseText = await readBoundedResponse(response);
        let envelope: unknown;
        try {
          envelope = JSON.parse(responseText);
        } catch (error) {
          throw new ProviderFailure("output_invalid", "Grok envelope was not JSON.", { cause: error });
        }
        const text = outputText(envelope);
        if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_TEXT_BYTES) {
          throw new ProviderFailure("output_invalid", "Grok output was oversized.");
        }
        return parseProviderText(text);
      } catch (error) {
        if (error instanceof ProviderFailure) {
          throw error;
        }
        if (signal.aborted) {
          throw cancellationFailure(error);
        }
        if (attempt.signal.aborted) {
          throw new ProviderFailure("unavailable", "Grok timed out.", { cause: error });
        }
        if (hasKnownNetworkCause(error)) {
          throw new ProviderFailure("unavailable", "Grok connection failed.", { cause: error });
        }
        throw new ProviderFailure("application_bug", "Unexpected Grok adapter failure.", { cause: error });
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener("abort", relayAbort);
      }
    },
  };
}
